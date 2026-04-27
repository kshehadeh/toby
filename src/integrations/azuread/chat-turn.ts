import type { LanguageModelUsage, ProviderMetadata } from "ai";
import type { AskUserHandler } from "../../ai/ask-user-tool";
import { withAskUserTool } from "../../ai/ask-user-tool";
import type { ChatWithToolsOptions, CoreMessage } from "../../ai/chat";
import { chatWithTools, createModelForPersona } from "../../ai/chat";
import type { Persona } from "../../config/index";
import { createAzureAdTools } from "./tools";

export async function runAzureAdChatTurn(params: {
	readonly messages: CoreMessage[];
	readonly persona: Persona;
	readonly dryRun: boolean;
	readonly maxResults?: number;
	readonly askUser?: AskUserHandler;
	readonly chatWithToolsOptions?: ChatWithToolsOptions;
}): Promise<{
	readonly text: string;
	readonly toolCalls: { name: string; args: Record<string, unknown> }[];
	readonly appliedActions: string[];
	readonly responseMessages: CoreMessage[];
	readonly usage?: LanguageModelUsage;
	readonly providerMetadata?: ProviderMetadata;
}> {
	const ctx = { dryRun: params.dryRun, appliedActions: [] as string[] };
	const tools = withAskUserTool(createAzureAdTools(ctx), params.askUser);
	const model = createModelForPersona(params.persona);
	const result = await chatWithTools(
		model,
		params.messages,
		tools,
		params.chatWithToolsOptions,
	);
	return {
		text: result.text,
		toolCalls: result.toolCalls,
		appliedActions: [...ctx.appliedActions],
		responseMessages: result.responseMessages,
		usage: result.usage,
		providerMetadata: result.providerMetadata,
	};
}
