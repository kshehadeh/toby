import type { Tool } from "ai";
import type { LanguageModelUsage, ProviderMetadata } from "ai";
import type { AskUserHandler } from "../../ai/ask-user-tool";
import { withAskUserTool } from "../../ai/ask-user-tool";
import { applyChatPromptCaching } from "../../ai/cache-hints";
import type { ChatWithToolsOptions, CoreMessage } from "../../ai/chat";
import { chatWithTools, createModelForPersona } from "../../ai/chat";
import type { Persona } from "../../config/index";
import { runAzureAdChatTurn } from "../../integrations/azuread/chat-turn";
import { createAzureAdTools } from "../../integrations/azuread/tools";
import { runGmailChatTurn } from "../../integrations/gmail/chat-turn";
import type { EmailContext } from "../../integrations/gmail/tools";
import { createGmailTools } from "../../integrations/gmail/tools";
import { runTodoistChatTurn } from "../../integrations/todoist/chat-turn";
import { createTodoistTools } from "../../integrations/todoist/tools";
import type { IntegrationModule } from "../../integrations/types";

export async function runIntegrationChatTurn(
	moduleNames: readonly IntegrationModule["name"][],
	messages: CoreMessage[],
	options: {
		readonly persona: Persona;
		readonly dryRun: boolean;
		readonly maxResults?: number;
		readonly askUser?: AskUserHandler;
		readonly chatWithToolsOptions?: ChatWithToolsOptions;
	},
): Promise<{
	readonly text: string;
	readonly toolCalls: { name: string; args: Record<string, unknown> }[];
	readonly appliedActions: string[];
	readonly responseMessages: CoreMessage[];
	readonly usage?: LanguageModelUsage;
	readonly providerMetadata?: ProviderMetadata;
}> {
	const unique = [...new Set(moduleNames)];
	if (unique.length === 0) {
		throw new Error("runIntegrationChatTurn: no integrations selected");
	}
	if (unique.length === 1) {
		const moduleName = unique[0];
		if (!moduleName) {
			throw new Error("runIntegrationChatTurn: missing integration name");
		}
		const base = {
			messages,
			persona: options.persona,
			dryRun: options.dryRun,
			maxResults: options.maxResults,
			askUser: options.askUser,
			chatWithToolsOptions: applyChatPromptCaching(
				options.chatWithToolsOptions,
				{
					persona: options.persona,
					moduleNames: unique,
				},
			),
		};

		if (moduleName === "gmail") {
			return runGmailChatTurn(base);
		}
		if (moduleName === "todoist") {
			return runTodoistChatTurn(base);
		}
		if (moduleName === "azuread") {
			return runAzureAdChatTurn(base);
		}

		throw new Error(
			`runIntegrationChatTurn: unsupported integration "${moduleName}"`,
		);
	}

	return runCombinedIntegrationChatTurn(unique, messages, options);
}

async function runCombinedIntegrationChatTurn(
	moduleNames: readonly IntegrationModule["name"][],
	messages: CoreMessage[],
	options: {
		readonly persona: Persona;
		readonly dryRun: boolean;
		readonly maxResults?: number;
		readonly askUser?: AskUserHandler;
		readonly chatWithToolsOptions?: ChatWithToolsOptions;
	},
): Promise<{
	readonly text: string;
	readonly toolCalls: { name: string; args: Record<string, unknown> }[];
	readonly appliedActions: string[];
	readonly responseMessages: CoreMessage[];
	readonly usage?: LanguageModelUsage;
	readonly providerMetadata?: ProviderMetadata;
}> {
	const gmailCtx: EmailContext = {
		currentEmail: null,
		dryRun: options.dryRun,
		appliedActions: [],
		listSampleMax:
			options.maxResults === undefined
				? undefined
				: Math.min(Math.max(1, options.maxResults), 500),
	};
	const todoistCtx = { dryRun: options.dryRun, appliedActions: [] as string[] };
	const azureadCtx = { dryRun: options.dryRun, appliedActions: [] as string[] };

	const mergedTools: Record<string, Tool> = {};
	for (const name of moduleNames) {
		if (name === "gmail") {
			Object.assign(mergedTools, createGmailTools(gmailCtx));
		} else if (name === "todoist") {
			Object.assign(mergedTools, createTodoistTools(todoistCtx));
		} else if (name === "azuread") {
			Object.assign(mergedTools, createAzureAdTools(azureadCtx));
		} else {
			throw new Error(
				`runCombinedIntegrationChatTurn: unsupported integration "${name}"`,
			);
		}
	}

	const tools = withAskUserTool(mergedTools, options.askUser);
	const model = createModelForPersona(options.persona);
	const result = await chatWithTools(
		model,
		messages,
		tools,
		applyChatPromptCaching(options.chatWithToolsOptions, {
			persona: options.persona,
			moduleNames,
		}),
	);

	return {
		text: result.text,
		toolCalls: result.toolCalls,
		appliedActions: [
			...gmailCtx.appliedActions,
			...todoistCtx.appliedActions,
			...azureadCtx.appliedActions,
		],
		responseMessages: result.responseMessages,
		usage: result.usage,
		providerMetadata: result.providerMetadata,
	};
}
