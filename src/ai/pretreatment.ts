import crypto from "node:crypto";
import { Output, generateText, zodSchema } from "ai";
import { z } from "zod";
import type { Persona } from "../config/index";
import { getDefaultProvider } from "../config/index";
import {
	ALL_PROVIDER_CATEGORIES,
	PROVIDER_CATEGORY_LABELS,
	type ProviderCategory,
} from "../integrations/types";
import {
	type LocalSkill,
	computeSkillCatalogSignature,
	formatSkillsCatalogForPrompt,
	inferRelevantSkillsFromUserPrompt,
} from "../skills/index";
import {
	getPretreatmentCache,
	setPretreatmentCache,
} from "../ui/chat/session-store";
import type { CoreMessage } from "./chat";
import {
	createModelForAuxiliary,
	resolveAuxiliaryModelId,
} from "./model-factory";

const PRETREATMENT_CACHE_SCHEMA_VERSION = "4";

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

const PREP_SYSTEM = `You extract a compact intent specification from a user message for a CLI assistant (Toby) that may use multiple integration tools.
You may also select relevant **local skills** when the catalog lists skills whose descriptions clearly match the user's request; otherwise leave relevantSkills empty.
You must also select **relevant tools** from the provided tool catalog — choose only the tools whose capabilities are clearly needed for the user's request. Do not include tools "just in case"; be selective to reduce context size. If unsure, leave relevantTools empty.
Return only structured fields that match the schema. Be conservative: if unsure, put detail in openQuestions rather than assumptions.
Do not invent email addresses, task IDs, or dates that are not in the user message.
For relevantSkills and relevantTools, use only exact names from the catalogs (no invented names).`;

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
}): string {
	const signature = JSON.stringify({
		schema: PRETREATMENT_CACHE_SCHEMA_VERSION,
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

/** Whether pretreatment is globally disabled via env. */
export function isPretreatmentDisabled(): boolean {
	return process.env.TOBY_DISABLE_PRETREATMENT === "1";
}

/** Whether pretreatment should run unconditionally on the first turn. */
export function isFirstTurnPretreatmentEnabled(): boolean {
	return process.env.TOBY_PRETREAT_FIRST_TURN === "1";
}

/** True when the latest non-system message is from the assistant (follow-up has recent context). */
function conversationEndsWithAssistant(
	messages: readonly CoreMessage[],
): boolean {
	for (let i = messages.length - 1; i >= 0; i--) {
		const role = messages[i]?.role;
		if (role === "system") {
			continue;
		}
		return role === "assistant";
	}
	return false;
}

/**
 * First turn: always pretreat (caller passes isFirstTurn=true).
 * Later turns: pretreat when the message looks ambiguous or underspecified.
 */
export function shouldPretreat(
	messages: readonly CoreMessage[] | null,
	userText: string,
	isFirstTurn: boolean,
): boolean {
	if (isPretreatmentDisabled()) {
		return false;
	}
	const t = userText.trim();
	if (!t) {
		return false;
	}
	if (isFirstTurn) {
		return isFirstTurnPretreatmentEnabled();
	}
	const msgs = messages ?? [];
	if (t.length < 22) {
		return true;
	}
	const pronoun =
		/\b(this|that|these|those|the same|above|those ones|it|them)\b/i.test(t);
	if (pronoun && !conversationEndsWithAssistant(msgs)) {
		return true;
	}
	const multiClause = /\band also\b|\band then\b|;/i.test(t);
	if (multiClause) {
		return true;
	}
	return false;
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
	readonly abortSignal?: AbortSignal;
	readonly timeoutMs?: number;
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
		params.timeoutMs ?? (hasSkillsCatalog || hasToolsCatalog ? 8000 : 4000);
	const text = userText.trim();
	if (!text) {
		return null;
	}

	const controller = new AbortController();
	const onAbort = () => controller.abort();
	if (abortSignal) {
		if (abortSignal.aborted) {
			return null;
		}
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
			maxOutputTokens: hasSkillsCatalog || hasToolsCatalog ? 2048 : 400,
		});
		const out = result.output;
		if (!out) {
			return null;
		}
		const withSkills = sanitizeRelevantSkills(
			out,
			params.allowedSkillNamesLower,
		);
		return sanitizeRelevantTools(withSkills, params.allowedToolNamesLower);
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
		if (abortSignal) {
			abortSignal.removeEventListener("abort", onAbort);
		}
	}
}

type WrapUserPromptParams = {
	readonly priorMessages: readonly CoreMessage[] | null;
	readonly rawUserText: string;
	readonly integrationLabels: string;
	readonly isFirstTurn: boolean;
	/** Persona whose AI provider drives pretreatment; defaults to configured default persona. */
	readonly persona?: Persona;
	/** Local ~/.toby/skills entries; omit or pass [] when none. */
	readonly skillsCatalog?: readonly LocalSkill[];
	/** Compact tool catalog string (name + description + params) for tool selection. */
	readonly toolsCatalogText?: string;
	/** Set of allowed tool names (lowercased) for sanitization. */
	readonly allowedToolNamesLower?: ReadonlySet<string>;
	readonly abortSignal?: AbortSignal;
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
	const toolsCatalogSignature = sha256Base64Url(toolsCatalogText).slice(0, 20);

	const modelId = getPretreatmentModelId(params.persona);
	const promptKey = buildPretreatmentCacheKey({
		userText: raw,
		integrationLabels: params.integrationLabels,
		modelId,
		skillsCatalogSignature,
		toolsCatalogSignature,
	});
	if (canUsePretreatmentCache()) {
		const cached = getPretreatmentCache(promptKey);
		const parsed = userIntentSpecSchema.safeParse(cached);
		if (parsed.success) {
			const withSkills = sanitizeRelevantSkills(
				parsed.data,
				allowedSkillNamesLower,
			);
			const withTools = sanitizeRelevantTools(
				withSkills,
				allowedToolNamesLower,
			);
			const merged = mergeSkillHeuristicIntoSpec(
				raw,
				withTools,
				skills,
				allowedSkillNamesLower,
			);
			return {
				content: formatUserMessageWithPretreatment(raw, merged, skills),
				spec: merged,
			};
		}
	}

	const modelSpec = await pretreatUserPrompt({
		userText: raw,
		integrationLabels: params.integrationLabels,
		skillsCatalogText,
		allowedSkillNamesLower,
		toolsCatalogText,
		allowedToolNamesLower,
		abortSignal: params.abortSignal,
		persona: params.persona,
	});
	if (modelSpec && canUsePretreatmentCache()) {
		setPretreatmentCache(promptKey, modelSpec);
	}
	const spec = mergeSkillHeuristicIntoSpec(
		raw,
		modelSpec,
		skills,
		allowedSkillNamesLower,
	);
	return {
		content: formatUserMessageWithPretreatment(raw, spec, skills),
		spec,
	};
}
