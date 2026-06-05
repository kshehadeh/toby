import { randomUUID } from "node:crypto";
import {
	type LanguageModel,
	type LanguageModelUsage,
	type ModelMessage,
	type ProviderMetadata,
	type Tool,
	generateText,
	stepCountIs,
	streamText,
} from "ai";
import type { ChatEventSink } from "../chat-pipeline/chat-events";
import {
	getCachedToolResult,
	isReadOnlyChatTool,
	setCachedToolResult,
} from "../chat-pipeline/tool-result-cache";
import { formatChattingWithPersona } from "../pipeline-footer";
import { enrichChatModelError } from "./chat-errors";
export { formatChatModelError } from "./chat-errors";
export { createModelForPersona } from "./model-factory";

export type CoreMessage = ModelMessage;

type ToolCallLifecycleStart = {
	readonly toolName: string;
	readonly blockKey: string;
	readonly args: Record<string, unknown>;
};

type ToolCallLifecycleComplete = {
	readonly toolName: string;
	readonly blockKey: string;
	readonly args: Record<string, unknown>;
	readonly result: unknown;
	readonly error?: unknown;
	readonly cacheHit?: boolean;
};

export type ChatWithToolsOptions = {
	/** Invoked at the start of each tool `execute` (after the model chose the tool). */
	readonly onToolCallStart?: (e: ToolCallLifecycleStart) => void;
	/** Invoked after each tool `execute` finishes (success or thrown error). */
	readonly onToolCallComplete?: (e: ToolCallLifecycleComplete) => void;
	/**
	 * When set, uses `streamText` and invokes this for each text delta (e.g. Ink TUI).
	 * Non-streaming callers (e.g. organize) omit this and use `generateText`.
	 */
	readonly onAssistantTextDelta?: (delta: string) => void;
	/**
	 * Optional UI-agnostic pipeline events (prep is emitted by the session layer).
	 * When streaming, assistant segments break at tool boundaries.
	 */
	readonly onChatEvent?: ChatEventSink;
	/** Provider-specific options passed through to the model call. */
	readonly providerOptions?: unknown;
	/** Header label used for streamed assistant transcript segments. */
	readonly assistantHeader?: string;
	/**
	 * Optional abort signal for cancelling the model turn mid-flight.
	 * Propagated to `streamText` / `generateText` and checked during
	 * tool execution to abort long-running tools.
	 */
	readonly abortSignal?: AbortSignal;
};

type StreamToolContext = {
	readonly endAssistantSegment: () => void;
	readonly emit: ChatEventSink | undefined;
	readonly nextSeq: () => number;
};

function createAbortError(): Error {
	const error = new Error("Chat turn aborted");
	error.name = "AbortError";
	return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw createAbortError();
	}
}

async function awaitWithAbort<T>(
	promise: Promise<T>,
	signal: AbortSignal | undefined,
): Promise<T> {
	if (!signal) {
		return await promise;
	}
	throwIfAborted(signal);
	return await new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(createAbortError());
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then(resolve, reject).finally(() => {
			signal.removeEventListener("abort", onAbort);
		});
	});
}

/**
 * Wraps read-only tools with an in-memory cache. When a cache hit occurs,
 * the original `execute` is skipped entirely. Write tools pass through unchanged.
 */
function injectToolCache(tools: Record<string, Tool>): Record<string, Tool> {
	let needsWrapping = false;
	for (const name of Object.keys(tools)) {
		if (isReadOnlyChatTool(name) && tools[name]?.execute) {
			needsWrapping = true;
			break;
		}
	}
	if (!needsWrapping) {
		return tools;
	}

	const wrapped: Record<string, Tool> = {};
	for (const [name, tool] of Object.entries(tools)) {
		const execute = tool.execute;
		if (!execute || !isReadOnlyChatTool(name)) {
			wrapped[name] = tool;
			continue;
		}
		wrapped[name] = {
			...tool,
			execute: async (input, toolOptions) => {
				const args =
					input && typeof input === "object" && !Array.isArray(input)
						? (input as Record<string, unknown>)
						: {};
				const cached = getCachedToolResult(name, args);
				if (cached.hit) {
					return cached.value;
				}
				const result = await execute(input as never, toolOptions as never);
				setCachedToolResult(name, args, result);
				return result;
			},
		};
	}
	return wrapped;
}

/**
 * Wraps all tools with lifecycle hooks: event emission, start/complete callbacks,
 * and abort-signal checks. Returns tools unchanged when no hooks or events are needed.
 */
function injectToolLifecycleHooks(
	tools: Record<string, Tool>,
	options: ChatWithToolsOptions | undefined,
	streamCtx?: StreamToolContext,
): Record<string, Tool> {
	const onToolCallStart = options?.onToolCallStart;
	const onToolCallComplete = options?.onToolCallComplete;
	const abortSignal = options?.abortSignal;
	if (!onToolCallStart && !onToolCallComplete && !streamCtx?.emit) {
		return tools;
	}
	const wrapped: Record<string, Tool> = {};
	for (const [name, tool] of Object.entries(tools)) {
		const execute = tool.execute;
		if (!execute) {
			wrapped[name] = tool;
			continue;
		}
		wrapped[name] = {
			...tool,
			execute: async (input, toolOptions) => {
				const blockKey = randomUUID();
				const args =
					input && typeof input === "object" && !Array.isArray(input)
						? (input as Record<string, unknown>)
						: {};
				throwIfAborted(abortSignal);
				const allowCache = isReadOnlyChatTool(name);
				const cacheHit = allowCache && getCachedToolResult(name, args).hit;
				streamCtx?.endAssistantSegment();
				streamCtx?.emit?.({
					type: "tool_call_start",
					blockKey,
					seq: streamCtx.nextSeq(),
					toolName: name,
					args,
				});
				onToolCallStart?.({ toolName: name, blockKey, args });
				if (cacheHit) {
					const cachedValue = getCachedToolResult(name, args).value;
					streamCtx?.emit?.({
						type: "tool_call_complete",
						blockKey,
						seq: streamCtx.nextSeq(),
						toolName: name,
						args,
						result: cachedValue,
						cacheHit: true,
					});
					onToolCallComplete?.({
						toolName: name,
						blockKey,
						args,
						result: cachedValue,
						cacheHit: true,
					});
					return cachedValue;
				}
				try {
					const result = await awaitWithAbort(
						execute(input as never, toolOptions as never),
						abortSignal,
					);
					throwIfAborted(abortSignal);
					streamCtx?.emit?.({
						type: "tool_call_complete",
						blockKey,
						seq: streamCtx.nextSeq(),
						toolName: name,
						args,
						result,
						cacheHit: false,
					});
					onToolCallComplete?.({
						toolName: name,
						blockKey,
						args,
						result,
						cacheHit: false,
					});
					return result;
				} catch (error) {
					streamCtx?.emit?.({
						type: "tool_call_complete",
						blockKey,
						seq: streamCtx.nextSeq(),
						toolName: name,
						args,
						result: undefined,
						error,
					});
					onToolCallComplete?.({
						toolName: name,
						blockKey,
						args,
						result: undefined,
						error,
					});
					throw error;
				}
			},
		};
	}
	return wrapped;
}

export async function chatWithTools(
	model: LanguageModel,
	messages: CoreMessage[],
	tools: Record<string, Tool>,
	options?: ChatWithToolsOptions,
): Promise<{
	text: string;
	toolResults: unknown[];
	toolCalls: { name: string; args: Record<string, unknown> }[];
	/** Assistant + tool messages from this call — append to history for the next turn. */
	responseMessages: CoreMessage[];
	usage?: LanguageModelUsage;
	providerMetadata?: ProviderMetadata;
}> {
	const onAssistantTextDelta = options?.onAssistantTextDelta;
	const onChatEvent = options?.onChatEvent;
	const providerOptions = options?.providerOptions as unknown;
	const abortSignal = options?.abortSignal;

	let seq = 0;
	const nextSeq = () => {
		seq += 1;
		return seq;
	};

	let assistantSegmentId: string | null = null;
	const endAssistantSegment = () => {
		if (assistantSegmentId !== null && onChatEvent) {
			onChatEvent({
				type: "assistant_segment_end",
				id: assistantSegmentId,
				seq: nextSeq(),
			});
			assistantSegmentId = null;
		}
	};

	const streamCtx: StreamToolContext | undefined =
		onChatEvent !== undefined
			? { endAssistantSegment, emit: onChatEvent, nextSeq }
			: undefined;

	// Apply cache first (so cached reads skip execute entirely),
	// then wrap with lifecycle hooks (events, callbacks, abort).
	const cachedTools = injectToolCache(tools);
	const toolsForModel = injectToolLifecycleHooks(
		cachedTools,
		options,
		streamCtx,
	);

	/** Need streamText when either the legacy delta callback or chat pipeline events are used. */
	if (onAssistantTextDelta || onChatEvent) {
		let capturedStreamError: unknown;
		const result = streamText({
			model,
			messages,
			tools: toolsForModel,
			stopWhen: stepCountIs(12),
			providerOptions: providerOptions as never,
			abortSignal,
			onError: ({ error }) => {
				if (!capturedStreamError) {
					capturedStreamError = error;
				}
			},
		});

		const modelRequestId = randomUUID();
		if (onChatEvent) {
			onChatEvent({
				type: "lifecycle_start",
				id: modelRequestId,
				seq: nextSeq(),
				header: formatChattingWithPersona(options?.assistantHeader),
			});
		}

		let sawTextDelta = false;
		const stream = result.textStream[Symbol.asyncIterator]();
		while (true) {
			const next = await awaitWithAbort(stream.next(), abortSignal);
			throwIfAborted(abortSignal);
			if (next.done) {
				break;
			}
			const delta = next.value;
			if (onChatEvent && !sawTextDelta) {
				sawTextDelta = true;
				onChatEvent({
					type: "lifecycle_end",
					id: modelRequestId,
					seq: nextSeq(),
					detail: "Streaming assistant output…",
				});
			}
			if (onChatEvent) {
				if (assistantSegmentId === null) {
					assistantSegmentId = randomUUID();
					onChatEvent({
						type: "assistant_segment_start",
						id: assistantSegmentId,
						seq: nextSeq(),
						header: options?.assistantHeader ?? "Toby",
					});
				}
				onChatEvent({
					type: "assistant_text_delta",
					segmentId: assistantSegmentId,
					seq: nextSeq(),
					delta,
				});
			}
			onAssistantTextDelta?.(delta);
		}

		if (onChatEvent && !sawTextDelta) {
			onChatEvent({
				type: "lifecycle_end",
				id: modelRequestId,
				seq: nextSeq(),
				detail: "Model turn continued (tools or structured output).",
			});
		}

		endAssistantSegment();
		throwIfAborted(abortSignal);

		try {
			const [response, text, steps, toolResults, usage, providerMetadata] =
				await awaitWithAbort(
					Promise.all([
						result.response,
						result.text,
						result.steps,
						result.toolResults,
						result.usage,
						result.providerMetadata,
					]),
					abortSignal,
				);

			const toolCalls = steps.flatMap((step) =>
				step.toolCalls.map((tc) => ({
					name: tc.toolName,
					args:
						tc.input && typeof tc.input === "object" && !Array.isArray(tc.input)
							? (tc.input as Record<string, unknown>)
							: {},
				})),
			);

			return {
				text,
				toolResults,
				toolCalls,
				responseMessages: response.messages as CoreMessage[],
				usage,
				providerMetadata,
			};
		} catch (error) {
			throw enrichChatModelError(error, capturedStreamError);
		}
	}

	const result = await awaitWithAbort(
		generateText({
			model,
			messages,
			tools: toolsForModel,
			stopWhen: stepCountIs(12),
			providerOptions: providerOptions as never,
			abortSignal,
		}),
		abortSignal,
	);

	return {
		text: result.text,
		toolResults: result.toolResults,
		toolCalls: result.toolCalls.map((tc) => ({
			name: tc.toolName,
			args:
				tc.input && typeof tc.input === "object" && !Array.isArray(tc.input)
					? (tc.input as Record<string, unknown>)
					: {},
		})),
		responseMessages: result.response.messages as CoreMessage[],
		usage: result.usage,
		providerMetadata: result.providerMetadata,
	};
}
