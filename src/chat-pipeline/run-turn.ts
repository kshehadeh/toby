import type { LanguageModelUsage, ProviderMetadata, Tool } from "ai";
import type { AskUserHandler } from "../ai/ask-user-tool";
import { withAskUserTool } from "../ai/ask-user-tool";
import { applyChatMessageCaching, applyChatPromptCaching } from "../ai/caching";
import type { ChatWithToolsOptions, CoreMessage } from "../ai/chat";
import { chatWithTools, createModelForPersona } from "../ai/chat";
import { createGlobalChatTools } from "../ai/global-chat-tools";
import type { Persona } from "../config/index";
import { getIntegrationModule } from "../integrations/index";
import type { IntegrationModule } from "../integrations/types";
import { log } from "../logging/chat-log";
import { createMemoryTools } from "../memory/tools";
import { injectCurrentDateTimeIntoFirstSystemMessage } from "../ui/chat/prepare-messages";
import type { ChatEvent } from "./chat-events";

type ChatTurnOptions = {
	readonly persona: Persona;
	readonly dryRun: boolean;
	readonly maxResults?: number;
	readonly askUser?: AskUserHandler;
	readonly chatWithToolsOptions?: ChatWithToolsOptions;
};

type ChatTurnResult = {
	readonly text: string;
	readonly toolCalls: { name: string; args: Record<string, unknown> }[];
	readonly appliedActions: string[];
	readonly responseMessages: CoreMessage[];
	readonly usage?: LanguageModelUsage;
	readonly providerMetadata?: ProviderMetadata;
};

/**
 * Shared runner that resolves integration modules by name, merges their tools,
 * and runs a model turn with caching and lifecycle support.
 * Used for both single and multi-integration turns.
 */
export async function runIntegrationChatTurn(
	moduleNames: readonly IntegrationModule["name"][],
	messages: CoreMessage[],
	options: ChatTurnOptions,
): Promise<ChatTurnResult> {
	const unique = [...new Set(moduleNames)];
	if (unique.length === 0) {
		throw new Error("runIntegrationChatTurn: no integrations selected");
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

/**
 * Core turn runner: assembles tools from integration modules + global tools,
 * applies prompt caching, and calls `chatWithTools`.
 */
export async function runSharedChatTurn(
	modules: readonly IntegrationModule[],
	messages: CoreMessage[],
	options: ChatTurnOptions,
): Promise<ChatTurnResult> {
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
	const toolIntegrationLabels: Record<string, string> = {};
	for (let i = 0; i < toolBundles.length; i++) {
		const b = toolBundles[i];
		const module = modules[i];
		if (!b || !module) {
			continue;
		}
		Object.assign(mergedTools, b.tools);
		for (const toolName of Object.keys(b.tools)) {
			toolIntegrationLabels[toolName] = module.displayName;
		}
	}
	const appliedActionsArrays = toolBundles.map((b) => b.appliedActions);
	const appliedActions = appliedActionsArrays.flatMap((a) => [...a]);
	const globalAppliedSink: string[] = [];
	Object.assign(
		mergedTools,
		createGlobalChatTools({
			dryRun: options.dryRun,
			persona: options.persona,
			appliedActions: globalAppliedSink,
		}),
	);
	appliedActions.push(...globalAppliedSink);
	const memoryAppliedSink: string[] = [];
	Object.assign(
		mergedTools,
		createMemoryTools({
			userId: "default",
			dryRun: options.dryRun,
			appliedActions: memoryAppliedSink,
		}),
	);
	appliedActions.push(...memoryAppliedSink);
	const moduleNames = modules.map((m) => m.name);

	const tools = withAskUserTool(mergedTools, options.askUser);
	const model = createModelForPersona(options.persona);
	const turnStartMs = Date.now();
	log("info", "turn", "turn_start", {
		modules: moduleNames,
		messageCount: messages.length,
		toolCount: Object.keys(tools).length,
		model: options.persona.ai.model,
	});
	const cacheContext = {
		persona: options.persona,
		moduleNames,
	};
	const messagesWithDateTime =
		injectCurrentDateTimeIntoFirstSystemMessage(messages);
	const messagesForModel = applyChatMessageCaching(
		messagesWithDateTime,
		cacheContext,
	);
	const chatWithToolsOptions =
		applyChatPromptCaching(options.chatWithToolsOptions, cacheContext) ?? {};
	const onChatEvent = chatWithToolsOptions.onChatEvent;
	const enrichedChatWithToolsOptions: ChatWithToolsOptions =
		onChatEvent === undefined
			? {
					...chatWithToolsOptions,
					assistantHeader:
						chatWithToolsOptions.assistantHeader ?? options.persona.name,
				}
			: {
					...chatWithToolsOptions,
					assistantHeader:
						chatWithToolsOptions.assistantHeader ?? options.persona.name,
					onChatEvent: (event: ChatEvent) => {
						if (
							event.type === "tool_call_start" ||
							event.type === "tool_call_complete"
						) {
							const integrationLabel = toolIntegrationLabels[event.toolName];
							onChatEvent(
								integrationLabel === undefined
									? event
									: { ...event, integrationLabel },
							);
							return;
						}
						onChatEvent(event);
					},
				};

	const result = await chatWithTools(
		model,
		messagesForModel,
		tools,
		enrichedChatWithToolsOptions,
	);

	log("info", "turn", "turn_end", {
		durationMs: Date.now() - turnStartMs,
		toolCallCount: result.toolCalls.length,
		toolsUsed: result.toolCalls.map((tc) => tc.name),
		inputTokens: result.usage?.inputTokens,
		outputTokens: result.usage?.outputTokens,
	});

	return {
		text: result.text,
		toolCalls: result.toolCalls,
		appliedActions,
		responseMessages: result.responseMessages,
		usage: result.usage,
		providerMetadata: result.providerMetadata,
	};
}
