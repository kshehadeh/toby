import crypto from "node:crypto";
import { Output, generateText, zodSchema } from "ai";
import { z } from "zod";
import { isAbortError, throwIfAborted } from "../abort";
import type { Persona } from "../config/index";
import { getDefaultProvider } from "../config/index";
import {
	ALL_PROVIDER_CATEGORIES,
	PROVIDER_CATEGORY_LABELS,
	type ProviderCategory,
} from "../integrations/types";
import { resolveDefaultPersona } from "../personas/index";
import {
	type RoutingIndex,
	getActiveRoutingIndex,
	getRoutingMinScore,
	getRoutingTopK,
	isSemanticRoutingEnabled,
	resolveRoutingEmbedModelId,
	routeToolsAndSkills,
} from "../routing/index";
import { getPretreatmentCache, setPretreatmentCache } from "../session-store";
import {
	type LocalSkill,
	collectToolsForSelectedSkills,
	computeSkillCatalogSignature,
	formatSkillsCatalogForPrompt,
	inferRelevantSkillsFromUserPrompt,
	userRequestsSkillAuthoring,
} from "../skills/index";
import type { CoreMessage } from "./chat";
import {
	createModelForAuxiliary,
	resolveAuxiliaryModelId,
} from "./model-factory";

const PRETREATMENT_CACHE_SCHEMA_VERSION = "6";

export { isSemanticRoutingEnabled } from "../routing/config";

export type PriorPretreatment = {
	readonly rawUserText: string;
	readonly spec: UserIntentSpec;
};

const userIntentSpecSchema = z.object({
	goal: z.string().describe("One sentence: what the user wants to achieve"),
	mustDo: z.array(z.string()).describe("Concrete actions or outcomes"),
	mustNotDo: z.array(z.string()).describe("Constraints or things to avoid"),
	assumptions: z.array(z.string()).describe("Explicit assumptions if any"),
	openQuestions: z
		.array(z.string())
		.describe("Clarifications that would reduce ambiguity"),
	relevantIntegrations: z
		.array(z.string())
		.describe("Which integrations likely apply (names or short labels)"),
	relevantSkills: z
		.array(z.string())
		.describe(
			"Names of applicable local skills from the provided catalog (exact names only); empty if none apply",
		),
	relevantTools: z
		.array(z.string())
		.describe(
			"Names of tools from the provided catalog that are likely needed for this request (exact names only); empty if unsure",
		),
	sessionName: z
		.string()
		.describe(
			"A short descriptive name for this chat session (3-6 words, title case, no punctuation); e.g. 'Inbox Triage' or 'Schedule Team Meeting'",
		),
});

export type UserIntentSpec = z.infer<typeof userIntentSpecSchema>;

const PREP_SYSTEM = `You classify a user message for Toby (CLI assistant with integrations). Output structured fields only — no reasoning text, no chain-of-thought.
Select **relevantSkills** and **relevantTools** only when clearly required; prefer empty lists over guessing. Use exact catalog names only.
Include **createLocalSkill** only when the user explicitly asks to create or edit a skill under ~/.toby/skills. For such skill-authoring requests, prefer **createLocalSkill** over generic file writing (writeTextFile).
Be conservative: uncertain details go in openQuestions, not assumptions. Do not invent IDs, emails, or dates absent from the message.`;

const PREP_DELTA_SYSTEM = `You decide whether a follow-up message continues the same task with the same tool/skill scope as the previous turn.
Output structured fields only — no reasoning text. Set reusePriorSelection true when the new message is a continuation and prior skills/tools still apply.
When reusePriorSelection is true, omit relevantSkills and relevantTools unless the follow-up clearly needs additions or removals.
When reusePriorSelection is false, omit skill/tool lists (full pretreatment will run next).`;

const pretreatmentDeltaSchema = z.object({
	reusePriorSelection: z
		.boolean()
		.describe(
			"True when the follow-up continues the same task and prior skill/tool selection need not change",
		),
	goal: z
		.string()
		.optional()
		.describe(
			"One-sentence updated goal when the follow-up shifts focus slightly",
		),
	relevantSkills: z
		.array(z.string())
		.optional()
		.describe(
			"Skill names to add or replace when scope changes; exact catalog names only",
		),
	relevantTools: z
		.array(z.string())
		.optional()
		.describe("Tool names to add when scope changes; exact catalog names only"),
});

type PretreatmentDelta = z.infer<typeof pretreatmentDeltaSchema>;

/** Short acknowledgements that can reuse prior skill/tool selection without an LLM call. */
const TRIVIAL_FOLLOW_UP_RE =
	/^(ok|okay|yes|yeah|yep|thanks|thank you|thx|continue|go ahead|sure|do it|please do|sounds good|got it|perfect|great|proceed|next)\.?$/i;

/** Whether delta (follow-up) pretreatment is enabled. Disabled when `TOBY_PRETREAT_DELTA=0`. */
export function isDeltaPretreatmentEnabled(): boolean {
	return process.env.TOBY_PRETREAT_DELTA !== "0";
}

export function isTrivialFollowUp(userText: string): boolean {
	const t = userText.trim();
	if (t.length === 0 || t.length > 40) {
		return false;
	}
	return TRIVIAL_FOLLOW_UP_RE.test(t);
}

function sha256Base64Url(input: string): string {
	return crypto
		.createHash("sha256")
		.update(input)
		.digest("base64")
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

function normalizePretreatmentCacheText(input: string): string {
	return input.trim().replaceAll(/\s+/g, " ");
}

function normalizeIntegrationLabels(input: string): string {
	return normalizePretreatmentCacheText(input).toLowerCase();
}

function canUsePretreatmentCache(): boolean {
	return (
		typeof (globalThis as unknown as { Bun?: unknown }).Bun !== "undefined"
	);
}

function buildPretreatmentCacheKey(params: {
	readonly userText: string;
	readonly integrationLabels: string;
	readonly modelId: string;
	readonly skillsCatalogSignature: string;
	readonly toolsCatalogSignature: string;
	readonly routingMode: "semantic" | "llm";
}): string {
	const signature = JSON.stringify({
		schema: PRETREATMENT_CACHE_SCHEMA_VERSION,
		routingMode: params.routingMode,
		modelId: params.modelId,
		integrationLabels: normalizeIntegrationLabels(params.integrationLabels),
		userText: normalizePretreatmentCacheText(params.userText),
		skillsCatalogSignature: params.skillsCatalogSignature,
		toolsCatalogSignature: params.toolsCatalogSignature,
	});
	const digest = sha256Base64Url(signature).slice(0, 40);
	return `toby-pretreat-v${PRETREATMENT_CACHE_SCHEMA_VERSION}-${digest}`;
}

function getPretreatmentModelId(persona?: Persona): string {
	const providerId = persona?.ai.provider ?? "openai";
	return resolveAuxiliaryModelId(providerId);
}

function getPretreatmentCacheModelId(persona?: Persona): string {
	const p = persona ?? resolveDefaultPersona();
	if (isSemanticRoutingEnabled()) {
		return `${resolveRoutingEmbedModelId(p)}:k${getRoutingTopK()}:m${getRoutingMinScore()}`;
	}
	return getPretreatmentModelId(p);
}

function heuristicSessionName(userText: string): string {
	const words = userText.trim().split(/\s+/).filter(Boolean).slice(0, 6);
	if (words.length === 0) {
		return "";
	}
	return words
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
		.join(" ");
}

function buildMinimalIntentSpec(params: {
	readonly userText: string;
	readonly isFirstTurn: boolean;
	readonly routing: {
		readonly relevantTools: readonly string[];
		readonly relevantSkills: readonly string[];
		readonly relevantIntegrations: readonly string[];
	};
}): UserIntentSpec {
	return {
		goal: params.userText.trim() || "Address the user's request.",
		mustDo: [],
		mustNotDo: [],
		assumptions: [],
		openQuestions: [],
		relevantIntegrations: [...params.routing.relevantIntegrations],
		relevantSkills: [...params.routing.relevantSkills],
		relevantTools: [...params.routing.relevantTools],
		sessionName: params.isFirstTurn
			? heuristicSessionName(params.userText)
			: "",
	};
}

async function pretreatWithSemanticRouting(params: {
	readonly raw: string;
	readonly isFirstTurn: boolean;
	readonly persona?: Persona;
	readonly allowedToolNamesLower: ReadonlySet<string>;
	readonly allowedSkillNamesLower: ReadonlySet<string>;
	readonly toolIntegrationLabels: Readonly<Record<string, string>>;
	readonly routingIndex: RoutingIndex | null;
	readonly abortSignal?: AbortSignal;
}): Promise<UserIntentSpec | null> {
	const index = params.routingIndex ?? getActiveRoutingIndex() ?? null;
	const persona = params.persona ?? resolveDefaultPersona();
	const routing = await routeToolsAndSkills({
		persona,
		userText: params.raw,
		toolIntegrationLabels: params.toolIntegrationLabels,
		allowedToolNamesLower: params.allowedToolNamesLower,
		allowedSkillNamesLower: params.allowedSkillNamesLower,
		index,
		abortSignal: params.abortSignal,
	});
	return buildMinimalIntentSpec({
		userText: params.raw,
		isFirstTurn: params.isFirstTurn,
		routing,
	});
}

/** Whether pretreatment is globally disabled via env. */
export function isPretreatmentDisabled(): boolean {
	return process.env.TOBY_DISABLE_PRETREATMENT === "1";
}

/**
 * Reads the legacy `TOBY_PRETREAT_FIRST_TURN` flag.
 *
 * @deprecated Pretreatment now runs on every non-empty prompt, so this flag no
 * longer gates first-turn behavior. Retained for backwards compatibility.
 */
export function isFirstTurnPretreatmentEnabled(): boolean {
	return process.env.TOBY_PRETREAT_FIRST_TURN === "1";
}

/**
 * Pretreatment runs on every non-empty prompt so each turn validates the
 * request and narrows the tool/skill set to what is relevant. Savings on
 * follow-ups come from trivial reuse, delta pretreatment, and the SQLite cache
 * (`wrapUserPromptWithPretreatment`). Set `TOBY_DISABLE_PRETREATMENT=1` to opt
 * out entirely.
 *
 * Returning false would skip pretreatment and expose all tools to the main
 * model; follow-up optimizations reuse prior specs while still pretreating.
 */
export function shouldPretreat(
	_messages: readonly CoreMessage[] | null,
	userText: string,
	_isFirstTurn: boolean,
): boolean {
	if (isPretreatmentDisabled()) {
		return false;
	}
	return userText.trim().length > 0;
}

function bulletList(title: string, items: readonly string[]): string {
	if (items.length === 0) {
		return `- ${title}: (none)`;
	}
	return `- ${title}:\n${items.map((x) => `  - ${x}`).join("\n")}`;
}

function skillDescriptionLookup(
	skills: readonly LocalSkill[],
): Map<string, string> {
	return new Map(
		skills.map((s) => [
			s.name.toLowerCase(),
			s.summary ? `${s.description} — ${s.summary}` : s.description,
		]),
	);
}

function sanitizeRelevantSkills(
	spec: UserIntentSpec,
	allowedLower: ReadonlySet<string>,
): UserIntentSpec {
	const filtered = spec.relevantSkills.filter((n) =>
		allowedLower.has(n.trim().toLowerCase()),
	);
	return { ...spec, relevantSkills: filtered };
}

function sanitizeRelevantTools(
	spec: UserIntentSpec,
	allowedLower: ReadonlySet<string>,
): UserIntentSpec {
	const filtered = spec.relevantTools.filter((n) =>
		allowedLower.has(n.trim().toLowerCase()),
	);
	return { ...spec, relevantTools: filtered };
}

/**
 * When preflight fails or omits skills, infer from token overlap (see inferRelevantSkillsFromUserPrompt).
 * Does not override non-empty model-selected relevantSkills.
 */
function mergeSkillHeuristicIntoSpec(
	userText: string,
	spec: UserIntentSpec | null,
	skills: readonly LocalSkill[],
	allowedLower: ReadonlySet<string>,
): UserIntentSpec | null {
	if (skills.length === 0) {
		return spec;
	}
	const inferred = inferRelevantSkillsFromUserPrompt(userText, skills);
	const names = inferred.filter((n) =>
		allowedLower.has(n.trim().toLowerCase()),
	);
	if (names.length === 0) {
		return spec;
	}
	if (!spec) {
		return sanitizeRelevantSkills(
			{
				goal: "Address the user's request.",
				mustDo: [],
				mustNotDo: [],
				assumptions: [],
				openQuestions: [],
				relevantIntegrations: [],
				relevantSkills: names,
				relevantTools: [],
				sessionName: "",
			},
			allowedLower,
		);
	}
	if (spec.relevantSkills.length > 0) {
		return spec;
	}
	return sanitizeRelevantSkills(
		{ ...spec, relevantSkills: [...names] },
		allowedLower,
	);
}

/**
 * Union the tools declared by the spec's selected skills into relevantTools.
 *
 * This makes tool scope deterministic: when a skill is selected, its declared
 * tools/integrations are always in scope regardless of whether the auxiliary
 * model independently listed them in relevantTools.
 */
function applySkillDeclaredTools(
	spec: UserIntentSpec | null,
	skills: readonly LocalSkill[],
	allowedToolNamesLower: ReadonlySet<string>,
	toolIntegrationLabels: Readonly<Record<string, string>>,
): UserIntentSpec | null {
	if (!spec || spec.relevantSkills.length === 0) {
		return spec;
	}
	const declared = collectToolsForSelectedSkills({
		selectedSkillNames: spec.relevantSkills,
		skills,
		allowedToolNamesLower,
		toolIntegrationLabels,
	});
	if (declared.length === 0) {
		return spec;
	}
	const seen = new Set(spec.relevantTools.map((t) => t.trim().toLowerCase()));
	const merged = [...spec.relevantTools];
	for (const name of declared) {
		const lower = name.trim().toLowerCase();
		if (seen.has(lower)) {
			continue;
		}
		seen.add(lower);
		merged.push(name);
	}
	return { ...spec, relevantTools: merged };
}

function reusePriorPretreatmentSpec(
	raw: string,
	prior: UserIntentSpec,
): UserIntentSpec {
	const base = prior.goal.trim();
	const goal = base
		? `${base} (follow-up: ${raw})`
		: `Continue prior task (follow-up: ${raw})`;
	return { ...prior, goal };
}

function mergeDeltaIntoPriorSpec(
	prior: UserIntentSpec,
	delta: PretreatmentDelta,
	allowedSkillNamesLower: ReadonlySet<string>,
	allowedToolNamesLower: ReadonlySet<string>,
): UserIntentSpec {
	if (!delta.reusePriorSelection) {
		return prior;
	}
	let spec: UserIntentSpec = { ...prior };
	if (delta.goal?.trim()) {
		spec = { ...spec, goal: delta.goal.trim() };
	}
	if (delta.relevantSkills && delta.relevantSkills.length > 0) {
		spec = sanitizeRelevantSkills(
			{ ...spec, relevantSkills: [...delta.relevantSkills] },
			allowedSkillNamesLower,
		);
	}
	if (delta.relevantTools && delta.relevantTools.length > 0) {
		const seen = new Set(spec.relevantTools.map((t) => t.trim().toLowerCase()));
		const merged = [...spec.relevantTools];
		for (const name of delta.relevantTools) {
			const lower = name.trim().toLowerCase();
			if (!allowedToolNamesLower.has(lower) || seen.has(lower)) {
				continue;
			}
			seen.add(lower);
			merged.push(name);
		}
		spec = { ...spec, relevantTools: merged };
	}
	return spec;
}

/**
 * When the user expresses intent to author a local skill, deterministically
 * ensure `createLocalSkill` is selected so it is available (and preferred over
 * writeTextFile) regardless of the auxiliary routing model or routing mode.
 */
function applySkillAuthoringTool(
	userText: string,
	spec: UserIntentSpec | null,
): UserIntentSpec | null {
	if (!userRequestsSkillAuthoring(userText)) {
		return spec;
	}
	const tool = "createLocalSkill";
	const base: UserIntentSpec = spec ?? {
		goal: "Address the user's request.",
		mustDo: [],
		mustNotDo: [],
		assumptions: [],
		openQuestions: [],
		relevantIntegrations: [],
		relevantSkills: [],
		relevantTools: [],
		sessionName: "",
	};
	if (
		base.relevantTools.some(
			(t) => t.trim().toLowerCase() === tool.toLowerCase(),
		)
	) {
		return base;
	}
	return { ...base, relevantTools: [...base.relevantTools, tool] };
}

function finalizePretreatmentResult(params: {
	readonly raw: string;
	readonly spec: UserIntentSpec | null;
	readonly skills: readonly LocalSkill[];
	readonly allowedSkillNamesLower: ReadonlySet<string>;
	readonly allowedToolNamesLower: ReadonlySet<string>;
	readonly toolIntegrationLabels: Readonly<Record<string, string>>;
}): { readonly content: string; readonly spec: UserIntentSpec | null } {
	const merged = mergeSkillHeuristicIntoSpec(
		params.raw,
		params.spec,
		params.skills,
		params.allowedSkillNamesLower,
	);
	const withSkillAuthoring = applySkillAuthoringTool(params.raw, merged);
	const expanded = applySkillDeclaredTools(
		withSkillAuthoring,
		params.skills,
		params.allowedToolNamesLower,
		params.toolIntegrationLabels,
	);
	return {
		content: formatUserMessageWithPretreatment(
			params.raw,
			expanded,
			params.skills,
		),
		spec: expanded,
	};
}

/** Wrap verbatim user text plus optional structured spec for the main model. */
export function formatUserMessageWithPretreatment(
	verbatim: string,
	spec: UserIntentSpec | null,
	skillsCatalog?: readonly LocalSkill[],
): string {
	const v = verbatim.trim();
	if (!spec) {
		return v;
	}
	const lookup = skillsCatalog?.length
		? skillDescriptionLookup(skillsCatalog)
		: null;
	const skillLines =
		spec.relevantSkills.length === 0
			? []
			: spec.relevantSkills.map((name) => {
					const desc = lookup?.get(name.trim().toLowerCase());
					return desc ? `${name}: ${desc}` : name;
				});
	const sections = [
		"User request (verbatim):",
		JSON.stringify(v),
		"",
		"Auto-extracted intent (best-effort):",
		`- Goal: ${spec.goal.trim() || "(unspecified)"}`,
		`- Session name: ${spec.sessionName.trim() || "(unspecified)"}`,
		bulletList("Must", spec.mustDo),
		bulletList("Must not", spec.mustNotDo),
		bulletList("Assumptions", spec.assumptions),
		bulletList("Open questions", spec.openQuestions),
		bulletList("Likely integrations", spec.relevantIntegrations),
		bulletList("Selected skills", skillLines),
		bulletList("Selected tools", spec.relevantTools),
	];
	return sections.join("\n");
}

function buildDefaultProvidersForPretreatment(): string {
	const lines: string[] = [];
	for (const cat of ALL_PROVIDER_CATEGORIES) {
		const name = getDefaultProvider(cat);
		if (name) {
			lines.push(`- ${PROVIDER_CATEGORY_LABELS[cat]}: ${name}`);
		}
	}
	if (lines.length === 0) {
		return "";
	}
	return `Default providers (prefer these in relevantIntegrations when the request matches):\n${lines.join("\n")}`;
}

type PretreatUserPromptParams = {
	readonly userText: string;
	readonly integrationLabels: string;
	readonly skillsCatalogText: string;
	readonly allowedSkillNamesLower: ReadonlySet<string>;
	readonly toolsCatalogText: string;
	readonly allowedToolNamesLower: ReadonlySet<string>;
	readonly isFirstTurn: boolean;
	readonly abortSignal?: AbortSignal;
	readonly timeoutMs?: number;
};

type PretreatDeltaParams = {
	readonly prior: PriorPretreatment;
	readonly userText: string;
	readonly integrationLabels: string;
	readonly skillsCatalogText: string;
	readonly toolsCatalogText: string;
	readonly abortSignal?: AbortSignal;
	readonly timeoutMs?: number;
	readonly persona?: Persona;
};

/**
 * Calls a small model to extract intent. Returns null on failure/timeout so the caller can fall back to verbatim text.
 */
async function pretreatUserPrompt(
	params: PretreatUserPromptParams & { readonly persona?: Persona },
): Promise<UserIntentSpec | null> {
	const { userText, integrationLabels, abortSignal } = params;
	const hasSkillsCatalog = params.skillsCatalogText !== "(none)";
	const hasToolsCatalog = params.toolsCatalogText !== "(none)";
	const timeoutMs =
		params.timeoutMs ?? (hasSkillsCatalog || hasToolsCatalog ? 6000 : 4000);
	const maxOutputTokens =
		hasSkillsCatalog || hasToolsCatalog
			? params.isFirstTurn
				? 768
				: 512
			: 400;
	const text = userText.trim();
	if (!text) {
		return null;
	}

	const controller = new AbortController();
	const onAbort = () => controller.abort();
	if (abortSignal) {
		throwIfAborted(abortSignal);
		abortSignal.addEventListener("abort", onAbort, { once: true });
	}
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const model = createModelForAuxiliary({ persona: params.persona });
		const skillsSection = `Available local skills (use exact names in relevantSkills only when clearly applicable; otherwise return an empty list):
${params.skillsCatalogText}`;
		const toolsSection = hasToolsCatalog
			? `\n\nAvailable tools (use exact names in relevantTools only when clearly needed; otherwise return an empty list):\n${params.toolsCatalogText}`
			: "";
		const result = await generateText({
			model,
			system: PREP_SYSTEM,
			prompt: `${skillsSection}${toolsSection}

Integrations in scope: ${integrationLabels || "(none)"}
${buildDefaultProvidersForPretreatment()}

User message:
${text}`,
			output: Output.object({
				schema: zodSchema(userIntentSpecSchema),
				name: "UserIntentSpec",
				description: "Structured interpretation of the user request",
			}),
			abortSignal: controller.signal,
			temperature: 0,
			maxOutputTokens,
		});
		const out = result.output;
		if (!out) {
			return null;
		}
		const withSkills = sanitizeRelevantSkills(
			out,
			params.allowedSkillNamesLower,
		);
		const withTools = sanitizeRelevantTools(
			withSkills,
			params.allowedToolNamesLower,
		);
		if (!params.isFirstTurn) {
			return { ...withTools, sessionName: "" };
		}
		return withTools;
	} catch (e) {
		if (isAbortError(e)) {
			throw e;
		}
		throwIfAborted(abortSignal);
		return null;
	} finally {
		clearTimeout(timer);
		if (abortSignal) {
			abortSignal.removeEventListener("abort", onAbort);
		}
	}
}

/**
 * Lightweight follow-up pretreatment: decide whether prior skill/tool scope still applies.
 */
async function pretreatUserPromptDelta(
	params: PretreatDeltaParams,
): Promise<PretreatmentDelta | null> {
	const text = params.userText.trim();
	if (!text) {
		return null;
	}

	const controller = new AbortController();
	const onAbort = () => controller.abort();
	if (params.abortSignal) {
		throwIfAborted(params.abortSignal);
		params.abortSignal.addEventListener("abort", onAbort, { once: true });
	}
	const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 4000);

	try {
		const prior = params.prior;
		const model = createModelForAuxiliary({ persona: params.persona });
		const priorSkills =
			prior.spec.relevantSkills.length > 0
				? prior.spec.relevantSkills.join(", ")
				: "(none)";
		const priorTools =
			prior.spec.relevantTools.length > 0
				? prior.spec.relevantTools.join(", ")
				: "(none)";
		const result = await generateText({
			model,
			system: PREP_DELTA_SYSTEM,
			prompt: `Previous user message:
${prior.rawUserText.trim()}

Previous goal: ${prior.spec.goal.trim() || "(unspecified)"}
Previous selected skills: ${priorSkills}
Previous selected tools: ${priorTools}

Available local skills (exact names only if adding):
${params.skillsCatalogText}

Available tools (exact names only if adding):
${params.toolsCatalogText}

Integrations in scope: ${params.integrationLabels || "(none)"}

New user message:
${text}`,
			output: Output.object({
				schema: zodSchema(pretreatmentDeltaSchema),
				name: "PretreatmentDelta",
				description: "Follow-up scope decision",
			}),
			abortSignal: controller.signal,
			temperature: 0,
			maxOutputTokens: 256,
		});
		return result.output ?? null;
	} catch (e) {
		if (isAbortError(e)) {
			throw e;
		}
		throwIfAborted(params.abortSignal);
		return null;
	} finally {
		clearTimeout(timer);
		if (params.abortSignal) {
			params.abortSignal.removeEventListener("abort", onAbort);
		}
	}
}

type WrapUserPromptParams = {
	readonly priorMessages: readonly CoreMessage[] | null;
	readonly rawUserText: string;
	readonly integrationLabels: string;
	readonly isFirstTurn: boolean;
	readonly priorPretreatment?: PriorPretreatment;
	/** Persona whose AI provider drives pretreatment; defaults to configured default persona. */
	readonly persona?: Persona;
	/** Local ~/.toby/skills entries; omit or pass [] when none. */
	readonly skillsCatalog?: readonly LocalSkill[];
	/** Compact tool catalog string (name + description + params) for tool selection. */
	readonly toolsCatalogText?: string;
	/** Set of allowed tool names (lowercased) for sanitization. */
	readonly allowedToolNamesLower?: ReadonlySet<string>;
	/** Map of tool name → integration display label, for skill `integrations` expansion. */
	readonly toolIntegrationLabels?: Readonly<Record<string, string>>;
	readonly abortSignal?: AbortSignal;
	/** Pre-warmed embedding index from turn-init; falls back to module cache. */
	readonly routingIndex?: RoutingIndex | null;
};

/** Runs pretreatment when indicated and returns content for `role: "user"`. */
export async function wrapUserPromptWithPretreatment(
	params: WrapUserPromptParams,
): Promise<{ readonly content: string; readonly spec: UserIntentSpec | null }> {
	const raw = params.rawUserText.trim();
	if (!raw) {
		return { content: "", spec: null };
	}
	if (!shouldPretreat(params.priorMessages, raw, params.isFirstTurn)) {
		return { content: raw, spec: null };
	}

	const skills = params.skillsCatalog ?? [];
	const skillsCatalogSignature = computeSkillCatalogSignature(skills);
	const skillsCatalogText = formatSkillsCatalogForPrompt(skills);
	const allowedSkillNamesLower = new Set(
		skills.map((s) => s.name.trim().toLowerCase()),
	);

	const toolsCatalogText = params.toolsCatalogText ?? "(none)";
	const allowedToolNamesLower = params.allowedToolNamesLower ?? new Set();
	const toolIntegrationLabels = params.toolIntegrationLabels ?? {};
	const toolsCatalogSignature = sha256Base64Url(toolsCatalogText).slice(0, 20);

	const finalize = (spec: UserIntentSpec | null) =>
		finalizePretreatmentResult({
			raw,
			spec,
			skills,
			allowedSkillNamesLower,
			allowedToolNamesLower,
			toolIntegrationLabels,
		});

	const prior = params.priorPretreatment;
	if (prior && !params.isFirstTurn) {
		if (isTrivialFollowUp(raw)) {
			return finalize(reusePriorPretreatmentSpec(raw, prior.spec));
		}

		if (!isSemanticRoutingEnabled() && isDeltaPretreatmentEnabled()) {
			const delta = await pretreatUserPromptDelta({
				prior,
				userText: raw,
				integrationLabels: params.integrationLabels,
				skillsCatalogText,
				toolsCatalogText,
				abortSignal: params.abortSignal,
				persona: params.persona,
			});
			if (delta?.reusePriorSelection) {
				const merged = mergeDeltaIntoPriorSpec(
					prior.spec,
					delta,
					allowedSkillNamesLower,
					allowedToolNamesLower,
				);
				return finalize(merged);
			}
			if (delta && !delta.reusePriorSelection) {
				// Fall through to full pretreatment below.
			} else if (delta === null) {
				return finalize(reusePriorPretreatmentSpec(raw, prior.spec));
			}
		}
	}

	const routingMode = isSemanticRoutingEnabled() ? "semantic" : "llm";
	const modelId = getPretreatmentCacheModelId(params.persona);
	const promptKey = buildPretreatmentCacheKey({
		userText: raw,
		integrationLabels: params.integrationLabels,
		modelId,
		skillsCatalogSignature,
		toolsCatalogSignature,
		routingMode,
	});
	if (canUsePretreatmentCache()) {
		const cached = getPretreatmentCache(promptKey);
		const parsed = userIntentSpecSchema.safeParse(cached);
		if (parsed.success) {
			let fromCache = parsed.data;
			if (!params.isFirstTurn) {
				fromCache = { ...fromCache, sessionName: "" };
			}
			return finalize(fromCache);
		}
	}

	let modelSpec: UserIntentSpec | null;
	if (isSemanticRoutingEnabled()) {
		modelSpec = await pretreatWithSemanticRouting({
			raw,
			isFirstTurn: params.isFirstTurn,
			persona: params.persona,
			allowedToolNamesLower,
			allowedSkillNamesLower,
			toolIntegrationLabels,
			routingIndex: params.routingIndex ?? null,
			abortSignal: params.abortSignal,
		});
	} else {
		modelSpec = await pretreatUserPrompt({
			userText: raw,
			integrationLabels: params.integrationLabels,
			skillsCatalogText,
			allowedSkillNamesLower,
			toolsCatalogText,
			allowedToolNamesLower,
			isFirstTurn: params.isFirstTurn,
			abortSignal: params.abortSignal,
			persona: params.persona,
		});
	}
	if (modelSpec && canUsePretreatmentCache()) {
		setPretreatmentCache(promptKey, modelSpec);
	}
	return finalize(modelSpec);
}
