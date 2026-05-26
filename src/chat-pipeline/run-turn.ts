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

/**
 * Tools that are always included regardless of pretreatment tool selection.
 * These are essential for the chat flow (askUser, time, skill loading)
 * or always-useful (memory tools).
 */
const ALWAYS_INCLUDED_TOOLS: ReadonlySet<string> = new Set([
	"askUser",
	"getCurrentDateTime",
	"loadLocalSkillInstructions",
	"createLocalSkill",
	"memorySearch",
	"memoryPropose",
	"memorySave",
	"memoryForget",
	"memoryExplain",
	"memoryRetrieveForTask",
]);

type ChatTurnOptions = {
	readonly persona: Persona;
	readonly dryRun: boolean;
	readonly maxResults?: number;
	readonly askUser?: AskUserHandler;
	readonly chatWithToolsOptions?: ChatWithToolsOptions;
	/**
	 * Tool names selected by pretreatment as relevant for this turn.
	 * When non-empty, only these tools (plus ALWAYS_INCLUDED_TOOLS)
	 * are exposed to the model. When empty/undefined, all tools pass through.
	 */
	readonly relevantTools?: readonly string[];
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
 * Build a compact tool catalog string (name + description + parameter names)
 * suitable for inclusion in pretreatment prompts.
 */
export function buildToolsCatalog(tools: Record<string, Tool>): string {
	const lines: string[] = [];
	for (const [name, t] of Object.entries(tools)) {
		const desc =
			typeof t.description === "string" ? t.description : "(no description)";
		let paramNames = "";
		try {
			const schema = t.inputSchema as unknown;
			if (
				schema &&
				typeof schema === "object" &&
				"shape" in (schema as object)
			) {
				const shape = (schema as { shape: Record<string, unknown> }).shape;
				if (shape && typeof shape === "object") {
					const keys = Object.keys(shape);
					if (keys.length > 0) {
						paramNames = ` (params: ${keys.join(", ")})`;
					}
				}
			}
		} catch {
			// Some tool schemas may not expose .shape; skip param extraction
		}
		lines.push(`- ${name}: ${desc}${paramNames}`);
	}
	return lines.length > 0 ? lines.join("\n") : "(none)";
}

/**
 * Eagerly resolve all tools for the given modules (integration + global + memory)
 * and return a compact catalog string for pretreatment consumption.
 */
export async function buildToolsCatalogForPretreatment(
	modules: readonly IntegrationModule[],
	options: { readonly dryRun?: boolean; readonly persona: Persona },
): Promise<{
	readonly catalogText: string;
	readonly allowedToolNamesLower: ReadonlySet<string>;
}> {
	const toolBundles = await Promise.all(
		modules.map(async (m) => {
			if (!m.createChatTools) return null;
			return await m.createChatTools({
				dryRun: options?.dryRun ?? false,
			});
		}),
	);
	const mergedTools: Record<string, Tool> = {};
	for (const b of toolBundles) {
		if (!b) continue;
		Object.assign(mergedTools, b.tools);
	}
	Object.assign(
		mergedTools,
		createGlobalChatTools({
			dryRun: options?.dryRun ?? false,
			persona: options.persona,
			appliedActions: [],
		}),
	);
	Object.assign(
		mergedTools,
		createMemoryTools({
			userId: "default",
			dryRun: options?.dryRun ?? false,
			appliedActions: [],
		}),
	);
	Object.assign(mergedTools, withAskUserTool(mergedTools, undefined));

	const catalogText = buildToolsCatalog(mergedTools);
	const allowedToolNamesLower = new Set(
		Object.keys(mergedTools).map((n) => n.trim().toLowerCase()),
	);
	return { catalogText, allowedToolNamesLower };
}

/**
 * Filter merged tools to only include relevant + always-included tools.
 * Returns all tools when relevantTools is empty/undefined (no regression).
 */
function filterToolsByRelevance(
	tools: Record<string, Tool>,
	relevantTools: readonly string[] | undefined,
): Record<string, Tool> {
	if (!relevantTools || relevantTools.length === 0) {
		return tools;
	}
	const relevantLower = new Set(
		relevantTools.map((n) => n.trim().toLowerCase()),
	);
	const filtered: Record<string, Tool> = {};
	for (const [name, tool] of Object.entries(tools)) {
		if (
			ALWAYS_INCLUDED_TOOLS.has(name) ||
			relevantLower.has(name.trim().toLowerCase())
		) {
			filtered[name] = tool;
		}
	}
	return filtered;
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

	// Filter tools based on pretreatment selection (no-op when relevantTools is empty)
	const filteredMergedTools = filterToolsByRelevance(
		mergedTools,
		options.relevantTools,
	);

	const tools = withAskUserTool(filteredMergedTools, options.askUser);
	const model = createModelForPersona(options.persona);
	const turnStartMs = Date.now();
	log("info", "turn", "turn_start", {
		modules: moduleNames,
		messageCount: messages.length,
		toolCount: Object.keys(tools).length,
		totalToolsAvailable: Object.keys(mergedTools).length,
		relevantTools: options.relevantTools ?? [],
		selectedToolNames: Object.keys(tools),
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
