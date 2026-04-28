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
import { readCredentials } from "../config/index";
import type { Persona } from "../config/index";

export type CoreMessage = ModelMessage;

export type ToolCallLifecycleStart = {
	readonly toolName: string;
	readonly blockKey: string;
};

export type ToolCallLifecycleComplete = {
	readonly toolName: string;
	readonly blockKey: string;
	readonly args: Record<string, unknown>;
	readonly result: unknown;
	readonly error?: unknown;
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
	/** Provider-specific options passed through to the model call. */
	readonly providerOptions?: unknown;
};

function injectToolLifecycleHooks(
	tools: Record<string, Tool>,
	options: ChatWithToolsOptions | undefined,
): Record<string, Tool> {
	const onToolCallStart = options?.onToolCallStart;
	const onToolCallComplete = options?.onToolCallComplete;
	if (!onToolCallStart && !onToolCallComplete) {
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
				onToolCallStart?.({ toolName: name, blockKey });
				const args =
					input && typeof input === "object" && !Array.isArray(input)
						? (input as Record<string, unknown>)
						: {};
				try {
					const result = await execute(input as never, toolOptions as never);
					onToolCallComplete?.({
						toolName: name,
						blockKey,
						args,
						result,
					});
					return result;
				} catch (error) {
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
	const providerOptions = options?.providerOptions as unknown;
	const toolsForModel = injectToolLifecycleHooks(tools, options);

	if (onAssistantTextDelta) {
		const result = streamText({
			model,
			messages,
			tools: toolsForModel,
			stopWhen: stepCountIs(12),
			providerOptions: providerOptions as never,
		});

		for await (const delta of result.textStream) {
			onAssistantTextDelta(delta);
		}

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
