import crypto from "node:crypto";
import { createOpenAI } from "@ai-sdk/openai";
import { Output, generateText, zodSchema } from "ai";
import { z } from "zod";
import { readCredentials } from "../config/index";
import {
	getPretreatmentCache,
	setPretreatmentCache,
} from "../ui/chat/session-store";
import type { CoreMessage } from "./chat";

export const PRETREATMENT_DEFAULT_MODEL = "gpt-4.1-mini";
const PRETREATMENT_CACHE_SCHEMA_VERSION = "1";

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
});

export type UserIntentSpec = z.infer<typeof userIntentSpecSchema>;

const PREP_SYSTEM = `You extract a compact intent specification from a user message for a CLI assistant (Toby) that may use multiple integration tools.
Return only structured fields that match the schema. Be conservative: if unsure, put detail in openQuestions rather than assumptions.
Do not invent email addresses, task IDs, or dates that are not in the user message.`;

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
}): string {
	const signature = JSON.stringify({
		schema: PRETREATMENT_CACHE_SCHEMA_VERSION,
		modelId: params.modelId,
		integrationLabels: normalizeIntegrationLabels(params.integrationLabels),
		userText: normalizePretreatmentCacheText(params.userText),
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

/** Wrap verbatim user text plus optional structured spec for the main model. */
export function formatUserMessageWithPretreatment(
	verbatim: string,
	spec: UserIntentSpec | null,
): string {
	const v = verbatim.trim();
	if (!spec) {
		return v;
	}
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
	];
	return sections.join("\n");
}

export type PretreatUserPromptParams = {
	readonly userText: string;
	readonly integrationLabels: string;
	readonly abortSignal?: AbortSignal;
	readonly timeoutMs?: number;
};

/**
 * Calls a small model to extract intent. Returns null on failure/timeout so the caller can fall back to verbatim text.
 */
export async function pretreatUserPrompt(
	params: PretreatUserPromptParams,
): Promise<UserIntentSpec | null> {
	const { userText, integrationLabels, abortSignal } = params;
	const timeoutMs = params.timeoutMs ?? 4000;
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
		const result = await generateText({
			model,
			system: PREP_SYSTEM,
			prompt: `Integrations in scope: ${integrationLabels || "(none)"}

User message:
${text}`,
			output: Output.object({
				schema: zodSchema(userIntentSpecSchema),
				name: "UserIntentSpec",
				description: "Structured interpretation of the user request",
			}),
			abortSignal: controller.signal,
			temperature: 0,
			maxOutputTokens: 400,
		});
		return result.output;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
		if (abortSignal) {
			abortSignal.removeEventListener("abort", onAbort);
		}
	}
}

export type WrapUserPromptParams = {
	readonly priorMessages: readonly CoreMessage[] | null;
	readonly rawUserText: string;
	readonly integrationLabels: string;
	readonly isFirstTurn: boolean;
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

	const modelId = getPretreatmentModelId();
	const promptKey = buildPretreatmentCacheKey({
		userText: raw,
		integrationLabels: params.integrationLabels,
		modelId,
	});
	if (canUsePretreatmentCache()) {
		const cached = getPretreatmentCache(promptKey);
		if (cached) {
			return {
				content: formatUserMessageWithPretreatment(raw, cached),
				spec: cached,
			};
		}
	}

	const spec = await pretreatUserPrompt({
		userText: raw,
		integrationLabels: params.integrationLabels,
		abortSignal: params.abortSignal,
	});
	if (spec && canUsePretreatmentCache()) {
		setPretreatmentCache(promptKey, spec);
	}
	return {
		content: formatUserMessageWithPretreatment(raw, spec),
		spec,
	};
}
