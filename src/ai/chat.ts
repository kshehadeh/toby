import { createOpenAI } from "@ai-sdk/openai";
import { type ModelMessage, type Tool, generateText, stepCountIs } from "ai";
import { readCredentials } from "../config/index";
import type { Persona } from "../config/index";

export type CoreMessage = ModelMessage;

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
): Promise<{
	text: string;
	toolResults: unknown[];
	toolCalls: { name: string; args: Record<string, unknown> }[];
}> {
	const result = await generateText({
		model,
		messages,
		tools,
		stopWhen: stepCountIs(5),
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
	};
}
