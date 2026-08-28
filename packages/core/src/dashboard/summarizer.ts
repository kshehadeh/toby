import fs from "node:fs";
import { generateText } from "ai";
import { createModelForPersona } from "../ai/model-factory";
import { type Persona, getDashboardSummariesPath } from "../config/index";
import { runFlow } from "../flows/runner";
import { daemonLog } from "../logging/daemon-log";
import { DASHBOARD_CONTENT_TTL_MS } from "./cache-ttl";
import { getDashboardCategory } from "./index";
import {
	CATEGORY_PROMPTS,
	buildDashboardSummarySystemPrompt,
	formatItemsForPrompt,
	resolveDashboardPersona,
} from "./prompts";
import type { DashboardBlockContent, DashboardCategorySummary } from "./types";

export {
	CATEGORY_PROMPTS,
	buildDashboardSummarySystemPrompt,
	formatItemsForPrompt,
	resolveDashboardPersona,
} from "./prompts";

const SUMMARY_TIMEOUT_MS = 30_000;
/** Room for a short markdown summary; higher than needed so partial CoT leak / reasoning tokens do not truncate the answer. */
const SUMMARY_MAX_TOKENS = 3000;

interface SummaryCacheEntry {
	readonly data: DashboardBlockContent | null;
	readonly expiresAt: number;
}

const summaryCache = new Map<string, SummaryCacheEntry>();
const inFlightSummaryRefreshes = new Map<
	string,
	Promise<DashboardBlockContent | null>
>();

// --- Disk persistence ---

interface PersistedSummaries {
	readonly [category: string]: DashboardBlockContent;
}

/** Map aggregator sources → content meta for Open actions. */
function contentSourcesFromCategory(
	data: DashboardCategorySummary,
): DashboardBlockContent["sources"] {
	return data.sources.map((s) => ({
		providerName: s.providerName,
		providerDisplayName: s.providerDisplayName,
		...(s.launchUrl ? { launchUrl: s.launchUrl } : {}),
	}));
}

function launchUrlsFromCategory(data: DashboardCategorySummary): string[] {
	return data.sources
		.map((s) => s.launchUrl)
		.filter((u): u is string => Boolean(u));
}

/** Content with no body markdown (zero items or no usable generation). */
function emptyBlockContent(
	category: string,
	data: DashboardCategorySummary,
	personaName: string,
): DashboardBlockContent {
	return {
		category,
		text: "",
		generatedAt: data.generatedAt,
		personaName,
		count: data.count,
		launchUrls: launchUrlsFromCategory(data),
		sources: contentSourcesFromCategory(data),
	};
}

/** Load persisted summaries from disk. Returns a map of category → summary. */
function loadPersistedSummaries(): PersistedSummaries {
	try {
		const filePath = getDashboardSummariesPath();
		if (!fs.existsSync(filePath)) return {};
		const raw = fs.readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw) as PersistedSummaries;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

/** Persist a single category summary to disk, merging with existing entries. */
function persistSummary(summary: DashboardBlockContent): void {
	// Do not persist empty bodies — they are cheap to recompute and avoid
	// sticky "blank card" after reconnecting a provider.
	if (!summary.text.trim()) return;
	try {
		const filePath = getDashboardSummariesPath();
		const existing = loadPersistedSummaries();
		const updated: PersistedSummaries = {
			...existing,
			[summary.category]: summary,
		};
		fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), "utf-8");
	} catch (error) {
		daemonLog("warn", "general", "dashboard_summary_persist_error", {
			category: summary.category,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

/** Remove a category entry from the on-disk summary file (e.g. CoT garbage). */
function clearPersistedSummary(category: string): void {
	try {
		const filePath = getDashboardSummariesPath();
		if (!fs.existsSync(filePath)) return;
		const existing = loadPersistedSummaries();
		if (!(category in existing)) return;
		const { [category]: _removed, ...rest } = existing;
		fs.writeFileSync(filePath, JSON.stringify(rest, null, 2), "utf-8");
	} catch (error) {
		daemonLog("warn", "general", "dashboard_summary_clear_error", {
			category,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

/** Get a persisted summary for a category, or null if none exists. */
function getPersistedSummary(category: string): DashboardBlockContent | null {
	const all = loadPersistedSummaries();
	const entry = all[category];
	if (!entry) return null;
	// Re-sanitize so older disk entries that stored chain-of-thought are not shown.
	const text = extractDashboardSummaryText(entry.text);
	if (!text) {
		clearPersistedSummary(category);
		return null;
	}
	if (text !== entry.text) {
		const cleaned: DashboardBlockContent = { ...entry, text };
		persistSummary(cleaned);
		return cleaned;
	}
	return entry;
}

/** Clear the AI summary cache. Useful for testing or config changes. */
export function clearDashboardSummaryCache(): void {
	summaryCache.clear();
	inFlightSummaryRefreshes.clear();
}

/** Build a stable cache key for a category + persona + data signature. */
function buildCacheKey(
	category: string,
	persona: Persona,
	dataSignature: string,
): string {
	return `${category}:${persona.name}:${persona.ai.provider}:${persona.ai.model}:${dataSignature}`;
}

/** Create a deterministic signature from category data for cache invalidation. */
function buildDataSignature(data: DashboardCategorySummary): string {
	const parts = [
		data.count,
		data.generatedAt,
		...data.items.map((i) => `${i.id}:${i.title}:${i.timestamp ?? ""}`),
	];
	return parts.join("|");
}

/**
 * Keep only the user-facing summary when a model dumps planning / chain-of-thought
 * into the main text (common with some reasoning models via generateText).
 *
 * Prefer the final answer after markdown headings or after explicit "here is the
 * summary" transitions when the preamble looks like internal monologue.
 * If the entire payload is planning with no salvageable summary, returns "".
 */
export function extractDashboardSummaryText(raw: string): string {
	let text = raw.trim();
	if (!text) return text;

	// Tagged reasoning / meta blocks (DeepSeek/Qwen, Grok-style, skill dumps).
	text = text
		.replace(/<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?>/gi, "")
		.replace(/<reasoning\b[^>]*>[\s\S]*?<\/reasoning>/gi, "")
		.replace(
			/<fidelity[-_]?matrix\b[^>]*>[\s\S]*?<\/fidelity[-_]?matrix>/gi,
			"",
		)
		.replace(/<\/?(?:skill|invoke|tool_call|antml)\b[^>]*>/gi, "")
		// Unclosed / truncated think tags (stream cut off mid-reasoning).
		.replace(/<think(?:ing)?\b[^>]*>[\s\S]*$/gi, "")
		.replace(/<reasoning\b[^>]*>[\s\S]*$/gi, "")
		.replace(/<fidelity[-_]?matrix\b[^>]*>[\s\S]*$/gi, "")
		// Single-line "skill name=..." crumbs (do not use \s* after the value —
		// \s matches newlines and would swallow the real summary).
		.replace(
			/^[ \t]*skill\s+name\s*=\s*["']?[\w.-]+["']?[ \t]*>?[ \t]*$/gim,
			"",
		)
		.trim();

	// Drop leading meta lines that look like tables or requirement matrices.
	text = stripLeadingMetaPreamble(text);

	// Planning first, then markdown sections (## / # headings).
	const headingMatch = /^(#{1,3}\s+\S)/m.exec(text);
	if (headingMatch?.index != null && headingMatch.index > 0) {
		const before = text.slice(0, headingMatch.index).trim();
		const after = text.slice(headingMatch.index).trim();
		if (
			before.length >= 40 &&
			(looksLikeModelPlanning(before) || looksLikeMetaLeak(before)) &&
			after.length > 0 &&
			!looksLikeModelPlanning(after) &&
			!looksLikeMetaLeak(after)
		) {
			return after;
		}
	}

	// Case-insensitive "Needs attention" style sections without markdown hashes
	// (models sometimes emit plain ALL CAPS headers after a CoT preamble).
	const sectionMatch =
		/^(#{0,3}\s*)?(needs attention|worth mentioning|today|tomorrow|later)\b/im.exec(
			text,
		);
	if (sectionMatch?.index != null && sectionMatch.index > 0) {
		const before = text.slice(0, sectionMatch.index).trim();
		const after = text.slice(sectionMatch.index).trim();
		if (
			before.length >= 20 &&
			(looksLikeModelPlanning(before) || looksLikeMetaLeak(before)) &&
			after.length > 0 &&
			!looksLikeMetaLeak(after)
		) {
			return after;
		}
	}

	// Explicit transition into the final answer.
	const transition =
		/\n(?:I(?:'ll| will) write|Final (?:answer|summary)|Here(?:'s| is) (?:the )?(?:summary|response)|Output|Draft(?:ed)? summary)\s*[:：]?\s*\n+/i.exec(
			text,
		);
	if (transition?.index != null) {
		const after = text.slice(transition.index + transition[0].length).trim();
		if (
			after.length >= 40 &&
			!looksLikeModelPlanning(after) &&
			!looksLikeMetaLeak(after)
		) {
			return after;
		}
	}

	// Whole response is internal monologue or leaked metadata (no summary).
	if (looksLikeModelPlanning(text) || looksLikeMetaLeak(text)) {
		return "";
	}

	return text;
}

/** Drop leading lines that look like requirement matrices / skill tables. */
function stripLeadingMetaPreamble(text: string): string {
	const lines = text.split("\n");
	let i = 0;
	while (i < lines.length) {
		const line = lines[i]?.trim() ?? "";
		if (!line) {
			i++;
			continue;
		}
		const isMetaLine =
			/^(category\s*\|\s*requirement|requirement\s*\|\s*source|fidelity[-_]?matrix|skill\s+name\s*=)/i.test(
				line,
			) ||
			/^[\w\s]+\|\s*[\w\s]+\|\s*[\w\s]+/.test(line) ||
			/^<\/?[a-z][\w:-]*\b[^>]*>$/i.test(line);
		if (!isMetaLine) break;
		i++;
	}
	if (i === 0) return text;
	return lines.slice(i).join("\n").trim();
}

/** Heuristic: text is skill/XML/meta leakage rather than a summary. */
function looksLikeMetaLeak(text: string): boolean {
	const patterns = [
		/<fidelity[-_]?matrix\b/i,
		/\bskill\s+name\s*=/i,
		/\bCategory\s*\|\s*Requirement\b/i,
		/\bRequirement\s*\|\s*Source\b/i,
		/<\/?(?:think(?:ing)?|reasoning|skill|invoke)\b/i,
		/\bAvailable skills\s*\(apply relevant/i,
	];
	return patterns.some((re) => re.test(text));
}

/** Heuristic: text reads like model planning rather than a user-facing summary. */
function looksLikeModelPlanning(text: string): boolean {
	const patterns = [
		/\bwe need to\b/i,
		/\blet'?s\b/i,
		/\bi(?:'ll| will)\b/i,
		/\bthe user (?:provided|says|asks|said)\b/i,
		/\bfor example, item\b/i,
		/\bi can (?:see|infer|compute)\b/i,
		/\bfocusing on\b/i,
		/\bcurrent date is not given\b/i,
		/\bstructure\b/i,
		/\bthe instruction\b/i,
		/\binstruction says\b/i,
		/\bso we need to\b/i,
		/\balso note\b/i,
		/\blet'?s count\b/i,
		/\btotal sentences\b/i,
		/\bthat'?s (?:more|less) than\b/i,
		/\bsentence \d+\s*:/i,
		/\bi recall\b/i,
		/\blet me try\b/i,
		/\bneed to condense\b/i,
		/\bwe should (?:write|structure|mention|cover)\b/i,
		/\bdo not go beyond\b/i,
		/\bactually it'?s\b/i,
		/\bbetter:\s/i,
		/\breasoning\b/i,
		/\bchain[- ]of[- ]thought\b/i,
	];
	const hits = patterns.filter((re) => re.test(text)).length;
	// Require 2+ hits so real summaries that say "let's" once still pass.
	return hits >= 2;
}

/**
 * Home-dashboard block content for one category (single client path).
 *
 * Fetches standard-tool/aggregator data server-side, then runs the category
 * flow when there are items. The card definition owns the header; this return
 * value is the body only.
 *
 * - `null` — unknown category, or no connected providers for that category
 * - content with `count === 0` / empty `text` — connected but nothing to show
 * - content with markdown — flow output
 *
 * Pass `force: true` (manual UI refresh) to bypass caches and await a fresh flow.
 */
export async function getDashboardBlockContent(
	category: string,
	params?: { readonly force?: boolean },
): Promise<DashboardBlockContent | null> {
	const force = params?.force === true;
	const categoryPrompt = CATEGORY_PROMPTS[category];
	if (!categoryPrompt) return null;

	// Aggregator data is internal to content generation (not a second client path).
	const data = await getDashboardCategory(category, {
		limit: 50,
		force,
	});
	if (!data) return null;

	const persona = resolveDashboardPersona();

	// Zero items: no flow/LLM — return empty content with open-link meta.
	if (data.count === 0) {
		return emptyBlockContent(category, data, persona.name);
	}

	const dataSignature = buildDataSignature(data);
	const cacheKey = buildCacheKey(category, persona, dataSignature);

	if (!force) {
		const cached = summaryCache.get(cacheKey);
		if (cached && Date.now() < cached.expiresAt) {
			return cached.data;
		}

		const persisted = getPersistedSummary(category);
		if (persisted) {
			summaryCache.set(cacheKey, {
				data: persisted,
				expiresAt: Date.now() + DASHBOARD_CONTENT_TTL_MS,
			});
			refreshSummary(cacheKey, category, data, persona, categoryPrompt).catch(
				() => {},
			);
			return persisted;
		}
	} else {
		summaryCache.delete(cacheKey);
	}

	return refreshSummary(cacheKey, category, data, persona, categoryPrompt);
}

/**
 * @deprecated Prefer {@link getDashboardBlockContent}.
 */
export async function getDashboardCategorySummary(
	category: string,
	params?: { readonly force?: boolean },
): Promise<DashboardBlockContent | null> {
	return getDashboardBlockContent(category, params);
}

/** Reuse an in-flight refresh for the same category/persona/data signature. */
function refreshSummary(
	cacheKey: string,
	category: string,
	data: DashboardCategorySummary,
	persona: Persona,
	categoryPrompt: string,
): Promise<DashboardBlockContent | null> {
	const inFlight = inFlightSummaryRefreshes.get(cacheKey);
	if (inFlight) return inFlight;

	const promise = generateFreshSummary(
		category,
		data,
		persona,
		categoryPrompt,
	).finally(() => {
		inFlightSummaryRefreshes.delete(cacheKey);
	});
	inFlightSummaryRefreshes.set(cacheKey, promise);
	return promise;
}

/** Generate a fresh AI summary, update caches, and persist to disk. */
async function generateFreshSummary(
	category: string,
	data: DashboardCategorySummary,
	persona: Persona,
	categoryPrompt: string,
): Promise<DashboardBlockContent | null> {
	const dataSignature = buildDataSignature(data);
	const cacheKey = buildCacheKey(category, persona, dataSignature);

	const nullCacheEntry: SummaryCacheEntry = {
		data: null,
		expiresAt: Date.now() + DASHBOARD_CONTENT_TTL_MS,
	};

	try {
		// Known categories use named flow pipelines (tool fetch + LLM).
		const flowName = DASHBOARD_CATEGORY_FLOWS[category];
		if (flowName) {
			return generateCategorySummaryViaFlow(
				category,
				flowName,
				data,
				persona,
				cacheKey,
				nullCacheEntry,
			);
		}

		// Fallback for any future category with a prompt but no flow yet.
		return generateLegacyCategorySummary(
			category,
			categoryPrompt,
			data,
			persona,
			cacheKey,
			nullCacheEntry,
		);
	} catch (error) {
		daemonLog("warn", "general", "dashboard_summary_error", {
			category,
			error: error instanceof Error ? error.message : String(error),
		});
		if (!summaryCache.has(cacheKey)) {
			summaryCache.set(cacheKey, nullCacheEntry);
		}
		return null;
	}
}

/** Categories that generate AI summaries via a named flow pipeline. */
const DASHBOARD_CATEGORY_FLOWS: Readonly<Record<string, string>> = {
	email: "dashboard.email.summary",
	tasks: "dashboard.tasks.summary",
	calendar: "dashboard.calendar.summary",
};

/**
 * Context bag keys used by dashboard flows for the tool-executor result
 * (standard tool payload with count / items / launchUrl).
 */
const FLOW_DATA_CONTEXT_KEYS: Readonly<Record<string, string>> = {
	"dashboard.email.summary": "unread",
	"dashboard.tasks.summary": "openTasks",
	"dashboard.calendar.summary": "upcoming",
};

/**
 * Legacy inline generateText path for categories that have a prompt but no
 * registered flow yet.
 */
async function generateLegacyCategorySummary(
	category: string,
	categoryPrompt: string,
	data: DashboardCategorySummary,
	persona: Persona,
	cacheKey: string,
	nullCacheEntry: SummaryCacheEntry,
): Promise<DashboardBlockContent | null> {
	const systemPrompt = buildDashboardSummarySystemPrompt(
		categoryPrompt,
		persona,
	);

	const itemsText = formatItemsForPrompt(data.items);
	const userPrompt = `Here are the ${category} items to summarize:\n\n${itemsText}`;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);

	try {
		const model = createModelForPersona(persona);
		const result = await generateText({
			model,
			instructions: systemPrompt,
			prompt: userPrompt,
			abortSignal: controller.signal,
			temperature: 0.3,
			maxOutputTokens: SUMMARY_MAX_TOKENS,
			// Do not pass reasoning: "none" — Grok 4.5 and similar reject
			// reasoning_effort=none as invalid. CoT is stripped via
			// extractDashboardSummaryText after generation.
		});

		const text = extractDashboardSummaryText(result.text);
		if (!text) {
			clearPersistedSummary(category);
			if (!summaryCache.has(cacheKey)) {
				summaryCache.set(cacheKey, nullCacheEntry);
			}
			daemonLog("warn", "general", "dashboard_summary_cot_stripped", {
				category,
				rawChars: result.text?.length ?? 0,
			});
			return emptyBlockContent(category, data, persona.name);
		}

		const summary: DashboardBlockContent = {
			category,
			text,
			generatedAt: new Date().toISOString(),
			personaName: persona.name,
			count: data.count,
			launchUrls: launchUrlsFromCategory(data),
			sources: contentSourcesFromCategory(data),
		};

		summaryCache.set(cacheKey, {
			data: summary,
			expiresAt: Date.now() + DASHBOARD_CONTENT_TTL_MS,
		});
		persistSummary(summary);
		return summary;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Run a dashboard category flow and map structured `{ markdown }` into the
 * AI summary contract (preserving cache + disk behavior).
 */
async function generateCategorySummaryViaFlow(
	category: string,
	flowName: string,
	data: DashboardCategorySummary,
	persona: Persona,
	cacheKey: string,
	nullCacheEntry: SummaryCacheEntry,
): Promise<DashboardBlockContent | null> {
	// Seed the flow bag with aggregator data under the same key the flow
	// tool node writes. If Tool Executor fails or returns empty, the LLM can
	// still summarize the items already shown on the card.
	const dataKey = FLOW_DATA_CONTEXT_KEYS[flowName] ?? "data";
	const seedPayload = {
		count: data.count,
		items: data.items,
		groups: data.groups,
		generatedAt: data.generatedAt,
		launchUrl: data.sources.find((s) => s.launchUrl)?.launchUrl,
	};

	daemonLog("info", "general", "dashboard_summary_flow_start", {
		category,
		flow: flowName,
		persona: persona.name,
		provider: persona.ai.provider,
		model: persona.ai.model,
		itemCount: data.count,
	});

	const flowResult = await runFlow(flowName, {
		personaOverride: persona,
		inputs: {
			[dataKey]: seedPayload,
		},
		trigger: `dashboard.summary:${category}`,
	});

	if (!flowResult.ok) {
		daemonLog("warn", "general", "dashboard_category_flow_error", {
			category,
			flow: flowName,
			persona: persona.name,
			model: `${persona.ai.provider}/${persona.ai.model}`,
			error: flowResult.error,
			failedNodeId: flowResult.failedNodeId,
		});
		if (!summaryCache.has(cacheKey)) {
			summaryCache.set(cacheKey, nullCacheEntry);
		}
		return null;
	}

	const toolData = flowResult.outputs[dataKey] as
		| { count?: number; launchUrl?: string; items?: unknown[] }
		| undefined;
	// Prefer non-zero tool/seed count; fall back to aggregator count.
	const itemCount =
		typeof toolData?.count === "number" && toolData.count > 0
			? toolData.count
			: data.count;
	if (itemCount === 0) {
		return emptyBlockContent(category, data, persona.name);
	}

	const summaryObj = flowResult.outputs.summary as
		| { markdown?: string }
		| undefined;
	const rawMarkdown =
		typeof summaryObj?.markdown === "string" ? summaryObj.markdown : "";
	const text = extractDashboardSummaryText(rawMarkdown);
	if (!text) {
		clearPersistedSummary(category);
		if (!summaryCache.has(cacheKey)) {
			summaryCache.set(cacheKey, nullCacheEntry);
		}
		daemonLog("warn", "general", "dashboard_summary_cot_stripped", {
			category,
			rawChars: rawMarkdown.length,
		});
		return emptyBlockContent(category, data, persona.name);
	}

	const launchUrlsFromFlow =
		typeof toolData?.launchUrl === "string" && toolData.launchUrl
			? [toolData.launchUrl]
			: [];
	const launchUrls =
		launchUrlsFromFlow.length > 0
			? launchUrlsFromFlow
			: launchUrlsFromCategory(data);

	const summary: DashboardBlockContent = {
		category,
		text,
		generatedAt: new Date().toISOString(),
		personaName: flowResult.persona.name,
		count: itemCount,
		launchUrls,
		sources: contentSourcesFromCategory(data),
	};

	summaryCache.set(cacheKey, {
		data: summary,
		expiresAt: Date.now() + DASHBOARD_CONTENT_TTL_MS,
	});
	persistSummary(summary);
	return summary;
}
