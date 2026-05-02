import { randomUUID } from "node:crypto";
import { createOpenAI } from "@ai-sdk/openai";
import {
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
import { readCredentials } from "../config/index";
import type { Persona } from "../config/index";

export type CoreMessage = ModelMessage;

export type ToolCallLifecycleStart = {
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
};

type StreamToolContext = {
	readonly endAssistantSegment: () => void;
	readonly emit: ChatEventSink | undefined;
	readonly nextSeq: () => number;
};

function injectToolLifecycleHooks(
	tools: Record<string, Tool>,
	options: ChatWithToolsOptions | undefined,
	streamCtx?: StreamToolContext,
): Record<string, Tool> {
	const onToolCallStart = options?.onToolCallStart;
	const onToolCallComplete = options?.onToolCallComplete;
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
				const allowCache = isReadOnlyChatTool(name);
				streamCtx?.endAssistantSegment();
				streamCtx?.emit?.({
					type: "tool_call_start",
					blockKey,
					seq: streamCtx.nextSeq(),
					toolName: name,
					args,
				});
				onToolCallStart?.({ toolName: name, blockKey, args });
				if (allowCache) {
					const cached = getCachedToolResult(name, args);
					if (cached.hit) {
						streamCtx?.emit?.({
							type: "tool_call_complete",
							blockKey,
							seq: streamCtx.nextSeq(),
							toolName: name,
							args,
							result: cached.value,
							cacheHit: true,
						});
						onToolCallComplete?.({
							toolName: name,
							blockKey,
							args,
							result: cached.value,
							cacheHit: true,
						});
						return cached.value;
					}
				}
				try {
					const result = await execute(input as never, toolOptions as never);
					if (allowCache) {
						setCachedToolResult(name, args, result);
					}
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

export function createModelForPersona(persona: Persona) {
	if (persona.ai.provider !== "openai") {
		throw new Error(
			`Unsupported AI provider: ${persona.ai.provider}. Only "openai" is supported.`,
		);
	}

	const creds = readCredentials();
	const token = creds.ai?.openai?.token;
	if (!token) {
		throw new Error(
			"OpenAI API token not configured. Run `toby configure` to set it.",
		);
	}

	const openai = createOpenAI({ apiKey: token });
	return openai(persona.ai.model);
}

export async function chatWithTools(
	model: ReturnType<typeof createModelForPersona>,
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

	const toolsForModel = injectToolLifecycleHooks(tools, options, streamCtx);

	/** Need streamText when either the legacy delta callback or chat pipeline events are used. */
	if (onAssistantTextDelta || onChatEvent) {
		const result = streamText({
			model,
			messages,
			tools: toolsForModel,
			stopWhen: stepCountIs(12),
			providerOptions: providerOptions as never,
		});

		for await (const delta of result.textStream) {
			if (onChatEvent) {
				if (assistantSegmentId === null) {
					assistantSegmentId = randomUUID();
					onChatEvent({
						type: "assistant_segment_start",
						id: assistantSegmentId,
						seq: nextSeq(),
						header: "Toby",
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

		endAssistantSegment();

		const [response, text, steps, toolResults, usage, providerMetadata] =
			await Promise.all([
				result.response,
				result.text,
				result.steps,
				result.toolResults,
				result.usage,
				result.providerMetadata,
			]);

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
	}

	const result = await generateText({
		model,
		messages,
		tools: toolsForModel,
		stopWhen: stepCountIs(12),
		providerOptions: providerOptions as never,
	});

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
