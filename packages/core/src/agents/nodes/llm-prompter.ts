import { Output, generateText, zodSchema } from "ai";
import type { z } from "zod";
import { createModelForPersona } from "../../ai/model-factory";
import { daemonLog } from "../../logging/daemon-log";
import type {
	AgentNodePromptContext,
	AgentNodeRuntime,
	LlmPrompterNodeDefinition,
} from "../types";
import { AgentNodeError } from "../types";

const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_MAX_OUTPUT_TOKENS = 1500;
const DEFAULT_TIMEOUT_MS = 45_000;
/** Cap structured-output attempt so slow/unsupported models fail fast into free-form. */
const STRUCTURED_ATTEMPT_TIMEOUT_MS = 12_000;

export type LlmPrompterNodeResult = {
	readonly object: unknown;
};

const DEFAULT_OUTPUTS = { object: "object" } as const;

export function defaultLlmPrompterOutputs(): typeof DEFAULT_OUTPUTS {
	return DEFAULT_OUTPUTS;
}

/**
 * Coerce free-form model text into the node schema when possible.
 * Prefer JSON that already matches the schema; otherwise wrap as `{ markdown }`
 * (dashboard agents) or a bare string schema.
 */
export function coerceFreeTextToSchema(
	schema: z.ZodTypeAny,
	text: string,
): unknown | null {
	const trimmed = text.trim();
	if (!trimmed) return null;

	// Model returned a JSON object string.
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			const result = schema.safeParse(parsed);
			if (result.success) return result.data;
		} catch {
			// fall through
		}
	}

	// Common dashboard agent shape: { markdown: string }
	const asMarkdown = schema.safeParse({ markdown: trimmed });
	if (asMarkdown.success) return asMarkdown.data;

	// Schema is a plain string (or other single-value types).
	const asValue = schema.safeParse(trimmed);
	if (asValue.success) return asValue.data;

	return null;
}

/**
 * True when the schema is (effectively) `{ markdown: string }` — free-form
 * markdown is the primary product, so skip a structured attempt that often
 * wastes latency on models without reliable Output.object support.
 */
export function isMarkdownOnlyObjectSchema(schema: z.ZodTypeAny): boolean {
	// Probe without depending on Zod internal _def shape APIs.
	if (!schema.safeParse({ markdown: "ok" }).success) return false;
	if (schema.safeParse({ markdown: 1 }).success) return false;
	if (schema.safeParse("ok").success) return false;
	if (schema.safeParse({ text: "ok" }).success) return false;
	return true;
}

function linkParentAbort(
	parent: AbortSignal | undefined,
	child: AbortController,
): () => void {
	if (!parent) return () => {};
	if (parent.aborted) {
		child.abort();
		return () => {};
	}
	const onAbort = () => child.abort();
	parent.addEventListener("abort", onAbort, { once: true });
	return () => parent.removeEventListener("abort", onAbort);
}

async function withTimeout<T>(
	timeoutMs: number,
	parent: AbortSignal | undefined,
	run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
	const controller = new AbortController();
	const unlink = linkParentAbort(parent, controller);
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await run(controller.signal);
	} finally {
		clearTimeout(timer);
		unlink();
	}
}

export async function runLlmPrompterNode(
	node: LlmPrompterNodeDefinition,
	inputs: Readonly<Record<string, unknown>>,
	runtime: AgentNodeRuntime,
): Promise<LlmPrompterNodeResult> {
	const promptCtx: AgentNodePromptContext = {
		persona: runtime.persona,
		bag: runtime.bag,
		inputs,
	};

	const systemPrompt = node.systemPrompt(promptCtx);
	const userPrompt = node.userPrompt(promptCtx);

	const temperature = node.temperature ?? DEFAULT_TEMPERATURE;
	const maxOutputTokens = node.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
	const timeoutMs = node.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	if (runtime.abortSignal?.aborted) {
		throw new AgentNodeError(node.id, "Aborted", "aborted");
	}

	try {
		const model = createModelForPersona(runtime.persona);
		const markdownOnly = isMarkdownOnlyObjectSchema(node.schema);

		// 1) Structured output — skip for simple { markdown } schemas (dashboard)
		//    where free-form is more reliable on many gateway models (e.g. DeepSeek).
		if (!markdownOnly) {
			const structuredTimeout = Math.min(
				STRUCTURED_ATTEMPT_TIMEOUT_MS,
				timeoutMs,
			);
			try {
				const structured = await withTimeout(
					structuredTimeout,
					runtime.abortSignal,
					(signal) =>
						generateText({
							model,
							instructions: systemPrompt,
							prompt: userPrompt,
							output: Output.object({
								schema: zodSchema(node.schema),
								name: node.schemaName ?? "AgentStructuredOutput",
								description:
									node.schemaDescription ?? "Structured output for agent node",
							}),
							abortSignal: signal,
							temperature,
							maxOutputTokens,
						}),
				);

				if (structured.output != null) {
					return { object: structured.output };
				}
			} catch (structuredError) {
				if (runtime.abortSignal?.aborted) {
					throw structuredError;
				}
				daemonLog("info", "general", "agent_llm_structured_fallback", {
					nodeId: node.id,
					error:
						structuredError instanceof Error
							? structuredError.message
							: String(structuredError),
				});
			}
		} else {
			daemonLog("debug", "general", "agent_llm_freeform_preferred", {
				nodeId: node.id,
				reason: "markdown_only_schema",
			});
		}

		// 2) Free-form generation with a **fresh full** timeout budget.
		//    (Previously shared one 30s timer with structured → free-form aborted.)
		const freeform = await withTimeout(
			timeoutMs,
			runtime.abortSignal,
			(signal) =>
				generateText({
					model,
					instructions: `${systemPrompt}

OUTPUT FORMAT:
- Reply with ONLY the final user-facing content in markdown.
- Do NOT include chain-of-thought, planning, or analysis of these instructions.
- Do NOT wrap the answer in a JSON object unless explicitly required.`,
					prompt: userPrompt,
					abortSignal: signal,
					temperature,
					maxOutputTokens,
				}),
		);

		const coerced = coerceFreeTextToSchema(node.schema, freeform.text ?? "");
		if (coerced == null) {
			throw new AgentNodeError(
				node.id,
				"Model returned no usable free-form output",
				"structured_output_null",
			);
		}

		return { object: coerced };
	} catch (error) {
		if (error instanceof AgentNodeError) throw error;
		const message = error instanceof Error ? error.message : String(error);
		const aborted =
			runtime.abortSignal?.aborted ||
			(error instanceof Error && /abort/i.test(error.message));
		throw new AgentNodeError(
			node.id,
			message,
			aborted ? "aborted" : "llm_error",
		);
	}
}
