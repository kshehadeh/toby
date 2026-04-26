import type { Tool } from "ai";
import type { AskUserHandler } from "../../ai/ask-user-tool";
import { withAskUserTool } from "../../ai/ask-user-tool";
import type { ChatWithToolsOptions, CoreMessage } from "../../ai/chat";
import { chatWithTools, createModelForPersona } from "../../ai/chat";
import type { Persona } from "../../config/index";
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
			chatWithToolsOptions: options.chatWithToolsOptions,
		};

		if (moduleName === "gmail") {
			return runGmailChatTurn(base);
		}
		if (moduleName === "todoist") {
			return runTodoistChatTurn(base);
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

	const mergedTools: Record<string, Tool> = {};
	for (const name of moduleNames) {
		if (name === "gmail") {
			Object.assign(mergedTools, createGmailTools(gmailCtx));
		} else if (name === "todoist") {
			Object.assign(mergedTools, createTodoistTools(todoistCtx));
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
		options.chatWithToolsOptions,
	);

	return {
		text: result.text,
		toolCalls: result.toolCalls,
		appliedActions: [...gmailCtx.appliedActions, ...todoistCtx.appliedActions],
		responseMessages: result.responseMessages,
	};
}
