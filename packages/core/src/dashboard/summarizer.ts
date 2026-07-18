import fs from "node:fs";
import { generateText } from "ai";
import { createModelForPersona } from "../ai/model-factory";
import {
	type Persona,
	getDashboardSummariesPath,
	readConfig,
} from "../config/index";
import { daemonLog } from "../logging/daemon-log";
import { resolveDefaultPersona, resolvePersona } from "../personas/index";
import { composeSystemPromptWithPersona } from "../personas/prompt";
import { formatSkillsCatalogForPrompt, loadLocalSkills } from "../skills/index";
import { getDashboardCategory } from "./index";
import type {
	DashboardCategoryAiSummary,
	DashboardCategorySummary,
	DashboardItem,
} from "./types";

const SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000;
const SUMMARY_TIMEOUT_MS = 30_000;
/** Room for a short markdown summary; higher than needed so partial CoT leak does not truncate the answer. */
const SUMMARY_MAX_TOKENS = 1500;

/** Built-in prompts per dashboard category. */
const CATEGORY_PROMPTS: Record<string, string> = {
	email: `Summarize unread emails (ordered by recency and focusing on the ones that are not mass mailings).
The summary should surface emails that should be attended to first followed by those that are worth mentioning.
This should be no longer than 5-6 sentences.`,
	tasks: `Summarize my tasks and reminders focusing on the ones that are most urgent, are particularly late or appear to be important based on the description.
This should be no longer than 5-6 sentences.`,
	calendar: `Summarize my upcoming calendar events for the next week.
Call out what is happening soonest, any conflicts or back-to-back blocks if obvious from the list, and anything that looks like a meeting I should prepare for.
This should be no longer than 5-6 sentences. Use "Today", "Tommorow", "Later" headers.  Do not go beyond the next three business days.  So, if it's Friday,
summarize events for Friday, Saturday, Sunday, Monday, and Tuesday. But if it's Monday then just
summarize events for Monday, Tuesday, and Wednesday.  If there are no events in the next three business days, then just say "No upcoming events in the next three business days."`,
};

interface SummaryCacheEntry {
	readonly data: DashboardCategoryAiSummary | null;
	readonly expiresAt: number;
}

const summaryCache = new Map<string, SummaryCacheEntry>();
const inFlightSummaryRefreshes = new Map<
	string,
	Promise<DashboardCategoryAiSummary | null>
>();

// --- Disk persistence ---

interface PersistedSummaries {
	readonly [category: string]: DashboardCategoryAiSummary;
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
function persistSummary(summary: DashboardCategoryAiSummary): void {
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
function getPersistedSummary(
	category: string,
): DashboardCategoryAiSummary | null {
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
		const cleaned: DashboardCategoryAiSummary = { ...entry, text };
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

/** Resolve the persona configured for dashboard summaries, falling back to default. */
export function resolveDashboardPersona(): Persona {
	const config = readConfig();
	const name = config.dashboard?.persona?.trim();
	if (name) {
		const resolved = resolvePersona(name);
		if (resolved) return resolved;
	}
	return resolveDefaultPersona();
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

/** Format dashboard items into readable text for the model. */
function formatItemsForPrompt(items: readonly DashboardItem[]): string {
	if (items.length === 0) return "(no items)";
	return items
		.map((item, idx) => {
			const sender = item.subtitle ?? "Unknown";
			const subject = item.title;
			const detail = item.detail ? ` — ${item.detail}` : "";
			const time = item.timestamp ? ` [${item.timestamp}]` : "";
			const urgency = item.urgency ? ` (${item.urgency} urgency)` : "";
			return `${idx + 1}. From: ${sender}\n   Subject: ${subject}${detail}${time}${urgency}`;
		})
		.join("\n");
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

	// Tagged reasoning blocks (DeepSeek/Qwen-style and similar).
	text = text
		.replace(/<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?>/gi, "")
		.replace(/<reasoning\b[^>]*>[\s\S]*?<\/reasoning>/gi, "")
		// Unclosed / truncated think tags (stream cut off mid-reasoning).
		.replace(/<think(?:ing)?\b[^>]*>[\s\S]*$/gi, "")
		.replace(/<reasoning\b[^>]*>[\s\S]*$/gi, "")
		.trim();

	// Planning first, then markdown sections (## / # headings).
	const headingMatch = /^(#{1,3}\s+\S)/m.exec(text);
	if (headingMatch?.index != null && headingMatch.index > 0) {
		const before = text.slice(0, headingMatch.index).trim();
		const after = text.slice(headingMatch.index).trim();
		if (
			before.length >= 80 &&
			looksLikeModelPlanning(before) &&
			after.length > 0 &&
			!looksLikeModelPlanning(after)
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
		if (after.length >= 40 && !looksLikeModelPlanning(after)) return after;
	}

	// Whole response is internal monologue (no user-facing summary at all).
	if (looksLikeModelPlanning(text)) {
		return "";
	}

	return text;
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
	];
	const hits = patterns.filter((re) => re.test(text)).length;
	// Require 2+ hits so real summaries that say "let's" once still pass.
	return hits >= 2;
}

/** Build the full system prompt with persona instructions, category prompt, and skills catalog. */
function buildSystemPrompt(
	categoryPrompt: string,
	persona: Persona,
	skillsCatalogText: string,
): string {
	const base = `You are a personal assistant summarizing dashboard information for the user.

${categoryPrompt}

CRITICAL OUTPUT RULES:
- Reply with ONLY the final user-facing summary in markdown.
- Do NOT include chain-of-thought, planning, self-checks, sentence counting, drafts, or analysis of these instructions.
- Do NOT write phrases like "we need to", "let's count", "the instruction says", "sentence 1:", or "also note".
- Start immediately with the summary (a heading or the first sentence for the user).

Format:
- Use **bold** for names, subjects, deadlines, and other key items the user should notice.
- Use bullet points for lists of items.
- Use a \`## \` sub-heading to separate "Needs attention" from "Worth mentioning" when appropriate.
- Keep the total response concise (5-6 sentences). Do not over-format — use markdown only where it genuinely aids readability.`;

	const withPersona = composeSystemPromptWithPersona(base, persona);

	const skillsSection =
		skillsCatalogText !== "(none)"
			? `\n\nAvailable skills (apply relevant context from these):\n${skillsCatalogText}`
			: "";

	return `${withPersona}${skillsSection}`;
}

/**
 * Generate an AI summary for a single dashboard category.
 * Uses the configured dashboard persona (or default) with built-in category prompts.
 * Cached for 5 minutes, keyed by category, persona, and data signature.
 * Returns `null` if no data exists for the category.
 */
export async function getDashboardCategorySummary(
	category: string,
): Promise<DashboardCategoryAiSummary | null> {
	const categoryPrompt = CATEGORY_PROMPTS[category];
	if (!categoryPrompt) return null;

	// Fetch deterministic category data (uses its own 60s cache)
	const data = await getDashboardCategory(category, { limit: 50 });
	if (!data || data.count === 0) return null;

	// Check AI summary cache (in-memory, 5 min TTL)
	const persona = resolveDashboardPersona();
	const dataSignature = buildDataSignature(data);
	const cacheKey = buildCacheKey(category, persona, dataSignature);

	const cached = summaryCache.get(cacheKey);
	if (cached && Date.now() < cached.expiresAt) {
		return cached.data;
	}

	// Fall back to persisted summary from disk (e.g. after daemon restart)
	// so the UI has something to show immediately, even if stale.
	const persisted = getPersistedSummary(category);
	if (persisted) {
		// Re-populate in-memory cache with the persisted entry so repeated
		// calls within the TTL window don't re-read the file.
		summaryCache.set(cacheKey, {
			data: persisted,
			expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS,
		});
		// Kick off a background refresh — the data may have changed since
		// the summary was last generated.
		refreshSummary(cacheKey, category, data, persona, categoryPrompt).catch(
			() => {},
		);
		return persisted;
	}

	// No persisted data — generate synchronously (caller waits)
	return refreshSummary(cacheKey, category, data, persona, categoryPrompt);
}

/** Reuse an in-flight refresh for the same category/persona/data signature. */
function refreshSummary(
	cacheKey: string,
	category: string,
	data: DashboardCategorySummary,
	persona: Persona,
	categoryPrompt: string,
): Promise<DashboardCategoryAiSummary | null> {
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
): Promise<DashboardCategoryAiSummary | null> {
	const dataSignature = buildDataSignature(data);
	const cacheKey = buildCacheKey(category, persona, dataSignature);

	const nullCacheEntry: SummaryCacheEntry = {
		data: null,
		expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS,
	};

	try {
		const skills = loadLocalSkills().filter((s) => s.enabled !== false);
		const skillsCatalogText = formatSkillsCatalogForPrompt(skills);

		const systemPrompt = buildSystemPrompt(
			categoryPrompt,
			persona,
			skillsCatalogText,
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
			});

			// Prefer the final answer text. Some models still dump planning into
			// `text`; strip that so the dashboard never shows chain-of-thought.
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
				return null;
			}

			const launchUrls = data.sources
				.map((s) => s.launchUrl)
				.filter((u): u is string => Boolean(u));

			const summary: DashboardCategoryAiSummary = {
				category,
				text,
				generatedAt: new Date().toISOString(),
				personaName: persona.name,
				count: data.count,
				launchUrls,
			};

			summaryCache.set(cacheKey, {
				data: summary,
				expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS,
			});

			persistSummary(summary);

			return summary;
		} finally {
			clearTimeout(timer);
		}
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
