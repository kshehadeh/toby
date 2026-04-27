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

export type ChatWithToolsOptions = {
	/** Invoked before each tool `execute` runs (AI SDK `experimental_onToolCallStart`). */
	readonly onToolCallStart?: (toolName: string) => void;
	/**
	 * When set, uses `streamText` and invokes this for each text delta (e.g. Ink TUI).
	 * Non-streaming callers (e.g. organize) omit this and use `generateText`.
	 */
	readonly onAssistantTextDelta?: (delta: string) => void;
	/** Provider-specific options passed through to the model call. */
	readonly providerOptions?: unknown;
};

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
	const onToolCallStart = options?.onToolCallStart;
	const onAssistantTextDelta = options?.onAssistantTextDelta;
	const providerOptions = options?.providerOptions as unknown;

	const toolStartHandler = onToolCallStart
		? (event: { toolCall: { toolName: string } }) => {
				onToolCallStart(event.toolCall.toolName);
			}
		: undefined;

	if (onAssistantTextDelta) {
		const result = streamText({
			model,
			messages,
			tools,
			stopWhen: stepCountIs(12),
			providerOptions: providerOptions as never,
			...(toolStartHandler
				? { experimental_onToolCallStart: toolStartHandler }
				: {}),
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
		tools,
		stopWhen: stepCountIs(12),
		providerOptions: providerOptions as never,
		...(toolStartHandler
			? { experimental_onToolCallStart: toolStartHandler }
			: {}),
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
