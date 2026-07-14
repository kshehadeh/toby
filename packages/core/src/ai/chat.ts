import { randomUUID } from "node:crypto";
import {
	type LanguageModel,
	type LanguageModelUsage,
	type ModelMessage,
	type ProviderMetadata,
	type Tool,
	generateText,
	isStepCount,
	streamText,
} from "ai";
import { awaitWithAbort, throwIfAborted } from "../abort";
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

type TextStreamPart = {
	readonly type: string;
	readonly text?: string;
	readonly toolCallId?: string;
	readonly toolName?: string;
	readonly input?: unknown;
	readonly output?: unknown;
	readonly argsTextDelta?: string;
	readonly isError?: boolean;
};

export type CoreMessage = ModelMessage;

function extractAssistantReplyText(
	text: string,
	responseMessages: readonly CoreMessage[],
): string {
	for (let i = responseMessages.length - 1; i >= 0; i--) {
		const msg = responseMessages[i];
		if (msg?.role !== "assistant") {
			continue;
		}
		const content = msg.content;
		if (typeof content === "string") {
			const fromString = content.trim();
			if (fromString.length > 0) {
				return fromString;
			}
			continue;
		}
		if (!Array.isArray(content)) {
			continue;
		}
		const joined = content
			.filter(
				(part): part is { type: "text"; text: string } =>
					typeof part === "object" &&
					part !== null &&
					"type" in part &&
					part.type === "text" &&
					"text" in part &&
					typeof part.text === "string",
			)
			.map((part) => part.text)
			.join("");
		const fromParts = joined.trim();
		if (fromParts.length > 0) {
			return fromParts;
		}
	}
	return text.trim();
}

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
	readonly durationMs?: number;
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
	readonly endAssistantSegment: (interim?: boolean) => void;
	readonly emit: ChatEventSink | undefined;
	readonly nextSeq: () => number;
	/** When true, tool_call_start/tool_call_complete events are emitted from
	 *  fullStream processing rather than from the execute wrapper. */
	readonly toolEventsFromStream: boolean;
};

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
 *
 * When `streamCtx.toolEventsFromStream` is true, tool_call_start/tool_call_complete
 * events and onToolCallStart/onToolCallComplete callbacks are emitted from fullStream
 * processing instead of the execute wrapper, so the hooks skip them here.
 */
function injectToolLifecycleHooks(
	tools: Record<string, Tool>,
	options: ChatWithToolsOptions | undefined,
	streamCtx?: StreamToolContext,
): Record<string, Tool> {
	const onToolCallStart = options?.onToolCallStart;
	const onToolCallComplete = options?.onToolCallComplete;
	const abortSignal = options?.abortSignal;
	const skipStreamToolEvents = streamCtx?.toolEventsFromStream === true;
	if (
		!onToolCallStart &&
		!onToolCallComplete &&
		!(streamCtx?.emit && !skipStreamToolEvents) &&
		!streamCtx
	) {
		return tools;
	}
	const emitToolEvents = !skipStreamToolEvents;
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
				const toolStartMs = Date.now();
				if (emitToolEvents) {
					streamCtx?.endAssistantSegment(true);
					streamCtx?.emit?.({
						type: "tool_call_start",
						blockKey,
						seq: streamCtx.nextSeq(),
						toolName: name,
						args,
					});
					onToolCallStart?.({ toolName: name, blockKey, args });
				}
				if (cacheHit) {
					const cachedValue = getCachedToolResult(name, args).value;
					if (emitToolEvents) {
						streamCtx?.emit?.({
							type: "tool_call_complete",
							blockKey,
							seq: streamCtx.nextSeq(),
							toolName: name,
							args,
							result: cachedValue,
							cacheHit: true,
							durationMs: Date.now() - toolStartMs,
						});
						onToolCallComplete?.({
							toolName: name,
							blockKey,
							args,
							result: cachedValue,
							cacheHit: true,
							durationMs: Date.now() - toolStartMs,
						});
					}
					return cachedValue;
				}
				try {
					const result = await awaitWithAbort(
						execute(input as never, toolOptions as never),
						abortSignal,
					);
					throwIfAborted(abortSignal);
					if (emitToolEvents) {
						streamCtx?.emit?.({
							type: "tool_call_complete",
							blockKey,
							seq: streamCtx.nextSeq(),
							toolName: name,
							args,
							result,
							cacheHit: false,
							durationMs: Date.now() - toolStartMs,
						});
						onToolCallComplete?.({
							toolName: name,
							blockKey,
							args,
							result,
							cacheHit: false,
							durationMs: Date.now() - toolStartMs,
						});
					}
					return result;
				} catch (error) {
					if (emitToolEvents) {
						streamCtx?.emit?.({
							type: "tool_call_complete",
							blockKey,
							seq: streamCtx.nextSeq(),
							toolName: name,
							args,
							result: undefined,
							error,
							durationMs: Date.now() - toolStartMs,
						});
						onToolCallComplete?.({
							toolName: name,
							blockKey,
							args,
							result: undefined,
							error,
							durationMs: Date.now() - toolStartMs,
						});
					}
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
	const endAssistantSegment = (interim = false) => {
		if (assistantSegmentId !== null && onChatEvent) {
			onChatEvent({
				type: "assistant_segment_end",
				id: assistantSegmentId,
				seq: nextSeq(),
				...(interim ? { interim: true } : {}),
			});
			assistantSegmentId = null;
		}
	};

	const streamCtx: StreamToolContext | undefined =
		onChatEvent !== undefined
			? {
					endAssistantSegment,
					emit: onChatEvent,
					nextSeq,
					toolEventsFromStream: true,
				}
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
			stopWhen: isStepCount(12),
			providerOptions: providerOptions as never,
			abortSignal,
			allowSystemInMessages: true,
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

		let reasoningSegmentId: string | null = null;
		const endReasoningSegment = () => {
			if (reasoningSegmentId !== null && onChatEvent) {
				onChatEvent({
					type: "reasoning_end",
					id: reasoningSegmentId,
					seq: nextSeq(),
				});
				reasoningSegmentId = null;
			}
		};

		let sawContent = false;
		const emittedToolCallStarts = new Map<string, number>();

		const stream = result.stream[Symbol.asyncIterator]();
		while (true) {
			const next = await awaitWithAbort(stream.next(), abortSignal);
			throwIfAborted(abortSignal);
			if (next.done) {
				break;
			}
			const part = next.value as TextStreamPart;

			if (part.type === "reasoning" && part.text) {
				if (!sawContent) {
					sawContent = true;
					onChatEvent?.({
						type: "lifecycle_end",
						id: modelRequestId,
						seq: nextSeq(),
						detail: "Model is thinking…",
					});
				}
				if (onChatEvent) {
					if (reasoningSegmentId === null) {
						reasoningSegmentId = randomUUID();
						onChatEvent({
							type: "reasoning_start",
							id: reasoningSegmentId,
							seq: nextSeq(),
						});
					}
					onChatEvent({
						type: "reasoning_delta",
						segmentId: reasoningSegmentId,
						seq: nextSeq(),
						delta: part.text,
					});
				}
				continue;
			}

			if (part.type === "reasoning-part-finish") {
				endReasoningSegment();
				continue;
			}

			if (part.type === "text-delta" && part.text) {
				if (!sawContent) {
					sawContent = true;
					onChatEvent?.({
						type: "lifecycle_end",
						id: modelRequestId,
						seq: nextSeq(),
						detail: "Streaming assistant output…",
					});
				}
				endReasoningSegment();
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
						delta: part.text,
					});
				}
				onAssistantTextDelta?.(part.text);
				continue;
			}

			if (part.type === "tool-call-streaming-start" && part.toolCallId) {
				if (!sawContent) {
					sawContent = true;
					onChatEvent?.({
						type: "lifecycle_end",
						id: modelRequestId,
						seq: nextSeq(),
						detail: "Model turn continued (tools or structured output).",
					});
				}
				endReasoningSegment();
				endAssistantSegment(true);
				if (onChatEvent && !emittedToolCallStarts.has(part.toolCallId)) {
					emittedToolCallStarts.set(part.toolCallId, Date.now());
					const args: Record<string, unknown> = {};
					onChatEvent({
						type: "tool_call_start",
						blockKey: part.toolCallId,
						seq: nextSeq(),
						toolName: part.toolName ?? "",
						args,
					});
				}
				options?.onToolCallStart?.({
					toolName: part.toolName ?? "",
					blockKey: part.toolCallId,
					args: {},
				});
				continue;
			}

			if (part.type === "tool-call" && part.toolCallId) {
				endReasoningSegment();
				endAssistantSegment(true);
				const args =
					part.input &&
					typeof part.input === "object" &&
					!Array.isArray(part.input)
						? (part.input as Record<string, unknown>)
						: {};
				if (onChatEvent && !emittedToolCallStarts.has(part.toolCallId)) {
					emittedToolCallStarts.set(part.toolCallId, Date.now());
					onChatEvent({
						type: "tool_call_start",
						blockKey: part.toolCallId,
						seq: nextSeq(),
						toolName: part.toolName ?? "",
						args,
					});
					options?.onToolCallStart?.({
						toolName: part.toolName ?? "",
						blockKey: part.toolCallId,
						args,
					});
				}
				continue;
			}

			if (part.type === "tool-result" && part.toolCallId) {
				const args =
					part.input &&
					typeof part.input === "object" &&
					!Array.isArray(part.input)
						? (part.input as Record<string, unknown>)
						: {};
				const toolStartMs = emittedToolCallStarts.get(part.toolCallId);
				if (onChatEvent) {
					onChatEvent({
						type: "tool_call_complete",
						blockKey: part.toolCallId,
						seq: nextSeq(),
						toolName: part.toolName ?? "",
						args,
						result: part.output,
						...(part.isError === true ? { error: part.output } : {}),
						...(toolStartMs !== undefined
							? { durationMs: Date.now() - toolStartMs }
							: {}),
					});
				}
				options?.onToolCallComplete?.({
					toolName: part.toolName ?? "",
					blockKey: part.toolCallId,
					args,
					result: part.output,
					...(part.isError === true ? { error: part.output } : {}),
					...(toolStartMs !== undefined
						? { durationMs: Date.now() - toolStartMs }
						: {}),
				});
			}
		}

		if (onChatEvent && !sawContent) {
			onChatEvent({
				type: "lifecycle_end",
				id: modelRequestId,
				seq: nextSeq(),
				detail: "Model turn continued (tools or structured output).",
			});
		}

		endReasoningSegment();
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

			const responseMessages = response.messages as CoreMessage[];
			const replyText = extractAssistantReplyText(text, responseMessages);

			return {
				text: replyText,
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
			stopWhen: isStepCount(12),
			providerOptions: providerOptions as never,
			abortSignal,
			allowSystemInMessages: true,
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
