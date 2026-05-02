import crypto from "node:crypto";
import { createOpenAI } from "@ai-sdk/openai";
import { Output, generateText, zodSchema } from "ai";
import { z } from "zod";
import { readCredentials } from "../config/index";
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

const PRETREATMENT_DEFAULT_MODEL = "gpt-4.1-mini";
const PRETREATMENT_CACHE_SCHEMA_VERSION = "2";

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
});

export type UserIntentSpec = z.infer<typeof userIntentSpecSchema>;

const PREP_SYSTEM = `You extract a compact intent specification from a user message for a CLI assistant (Toby) that may use multiple integration tools.
You may also select relevant **local skills** when the catalog lists skills whose descriptions clearly match the user's request; otherwise leave relevantSkills empty.
Return only structured fields that match the schema. Be conservative: if unsure, put detail in openQuestions rather than assumptions.
Do not invent email addresses, task IDs, or dates that are not in the user message.
For relevantSkills, use only exact skill names from the catalog (no invented names).`;

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
}): string {
	const signature = JSON.stringify({
		schema: PRETREATMENT_CACHE_SCHEMA_VERSION,
		modelId: params.modelId,
		integrationLabels: normalizeIntegrationLabels(params.integrationLabels),
		userText: normalizePretreatmentCacheText(params.userText),
		skillsCatalogSignature: params.skillsCatalogSignature,
	});
	const digest = sha256Base64Url(signature).slice(0, 40);
	return `toby-pretreat-v${PRETREATMENT_CACHE_SCHEMA_VERSION}-${digest}`;
}

function getPretreatmentModelId(): string {
	const fromEnv = process.env.TOBY_PRETREAT_MODEL?.trim();
	return fromEnv && fromEnv.length > 0 ? fromEnv : PRETREATMENT_DEFAULT_MODEL;
}

function createPretreatmentModel() {
	const creds = readCredentials();
	const token = creds.ai?.openai?.token;
	if (!token) {
		throw new Error(
			"OpenAI API token not configured. Run `toby configure` to set it.",
		);
	}
	const openai = createOpenAI({ apiKey: token });
	return openai(getPretreatmentModelId());
}

/** Whether pretreatment is globally disabled via env. */
export function isPretreatmentDisabled(): boolean {
	return process.env.TOBY_DISABLE_PRETREATMENT === "1";
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
		return true;
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
	return new Map(skills.map((s) => [s.name.toLowerCase(), s.description]));
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
		bulletList("Must", spec.mustDo),
		bulletList("Must not", spec.mustNotDo),
		bulletList("Assumptions", spec.assumptions),
		bulletList("Open questions", spec.openQuestions),
		bulletList("Likely integrations", spec.relevantIntegrations),
		bulletList("Selected skills", skillLines),
	];
	return sections.join("\n");
}

type PretreatUserPromptParams = {
	readonly userText: string;
	readonly integrationLabels: string;
	readonly skillsCatalogText: string;
	readonly allowedSkillNamesLower: ReadonlySet<string>;
	readonly abortSignal?: AbortSignal;
	readonly timeoutMs?: number;
};

/**
 * Calls a small model to extract intent. Returns null on failure/timeout so the caller can fall back to verbatim text.
 */
async function pretreatUserPrompt(
	params: PretreatUserPromptParams,
): Promise<UserIntentSpec | null> {
	const { userText, integrationLabels, abortSignal } = params;
	const hasSkillsCatalog = params.skillsCatalogText !== "(none)";
	const timeoutMs = params.timeoutMs ?? (hasSkillsCatalog ? 8000 : 4000);
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
		const model = createPretreatmentModel();
		const skillsSection = `Available local skills (use exact names in relevantSkills only when clearly applicable; otherwise return an empty list):
${params.skillsCatalogText}`;
		const result = await generateText({
			model,
			system: PREP_SYSTEM,
			prompt: `${skillsSection}

Integrations in scope: ${integrationLabels || "(none)"}

User message:
${text}`,
			output: Output.object({
				schema: zodSchema(userIntentSpecSchema),
				name: "UserIntentSpec",
				description: "Structured interpretation of the user request",
			}),
			abortSignal: controller.signal,
			temperature: 0,
			maxOutputTokens: hasSkillsCatalog ? 2048 : 400,
		});
		const out = result.output;
		if (!out) {
			return null;
		}
		return sanitizeRelevantSkills(out, params.allowedSkillNamesLower);
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
	/** Local ~/.toby/skills entries; omit or pass [] when none. */
	readonly skillsCatalog?: readonly LocalSkill[];
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

	const modelId = getPretreatmentModelId();
	const promptKey = buildPretreatmentCacheKey({
		userText: raw,
		integrationLabels: params.integrationLabels,
		modelId,
		skillsCatalogSignature,
	});
	if (canUsePretreatmentCache()) {
		const cached = getPretreatmentCache(promptKey);
		const parsed = userIntentSpecSchema.safeParse(cached);
		if (parsed.success) {
			const normalized = sanitizeRelevantSkills(
				parsed.data,
				allowedSkillNamesLower,
			);
			const merged = mergeSkillHeuristicIntoSpec(
				raw,
				normalized,
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
		abortSignal: params.abortSignal,
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
