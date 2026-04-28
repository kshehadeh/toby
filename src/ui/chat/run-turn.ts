import type { LanguageModelUsage, ProviderMetadata, Tool } from "ai";
import type { AskUserHandler } from "../../ai/ask-user-tool";
import { withAskUserTool } from "../../ai/ask-user-tool";
import { applyChatPromptCaching } from "../../ai/cache-hints";
import type { ChatWithToolsOptions, CoreMessage } from "../../ai/chat";
import { chatWithTools, createModelForPersona } from "../../ai/chat";
import type { Persona } from "../../config/index";
import { getIntegrationModule } from "../../integrations/index";
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
		const module = getIntegrationModule(moduleName);
		if (!module) {
			throw new Error(
				`runIntegrationChatTurn: unknown integration "${moduleName}"`,
			);
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
		if (module.runChatTurn) {
			return await module.runChatTurn(base);
		}
		return await runSharedChatTurn([module], messages, options);
	}

	const modules = unique
		.map((n) => {
			const mod = getIntegrationModule(n);
			if (!mod) {
				throw new Error(`runIntegrationChatTurn: unknown integration "${n}"`);
			}
			return mod;
		})
		.sort((a, b) => a.name.localeCompare(b.name));
	return await runSharedChatTurn(modules, messages, options);
}

async function runSharedChatTurn(
	modules: readonly IntegrationModule[],
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
	const toolBundles = await Promise.all(
		modules.map(async (m) => {
			if (!m.createChatTools) {
				throw new Error(
					`runIntegrationChatTurn: integration "${m.name}" does not export createChatTools`,
				);
			}
			return await m.createChatTools({
				dryRun: options.dryRun,
				maxResults: options.maxResults,
			});
		}),
	);
	const mergedTools: Record<string, Tool> = {};
	for (const b of toolBundles) {
		Object.assign(mergedTools, b.tools);
	}
	const appliedActionsArrays = toolBundles.map((b) => b.appliedActions);
	const appliedActions = appliedActionsArrays.flatMap((a) => [...a]);
	const moduleNames = modules.map((m) => m.name);

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
		appliedActions,
		responseMessages: result.responseMessages,
		usage: result.usage,
		providerMetadata: result.providerMetadata,
	};
}
