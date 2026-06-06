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
import { injectCurrentDateTimeIntoFirstSystemMessage } from "../prepare-messages";
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
	"memorySearch",
	"memoryPropose",
	"memorySave",
	"memoryForget",
	"memoryExplain",
	"memoryRetrieveForTask",
	"tobyListIntegrations",
	"tobyGetIntegrationSetup",
	"tobyListDefaults",
	"tobyListTools",
	"tobyListSkills",
	"tobyInstanceInfo",
	"fetchWebContent",
	"webSearch",
	"listListenRecordings",
	"readTranscript",
]);

/**
 * Tools omitted from the default set unless pretreatment (or the user) explicitly
 * selects them — analogous to Cursor skills with `disable-model-invocation: true`.
 */
const EXPLICIT_REQUEST_ONLY_TOOLS: ReadonlySet<string> = new Set([
	"createLocalSkill",
]);

type ChatTurnOptions = {
	readonly persona: Persona;
	readonly dryRun: boolean;
	readonly maxResults?: number;
	readonly askUser?: AskUserHandler;
	readonly chatWithToolsOptions?: ChatWithToolsOptions;
	/**
	 * Tool names selected by pretreatment as relevant for this turn.
	 * When defined, only these tools (plus ALWAYS_INCLUDED_TOOLS) are exposed,
	 * except EXPLICIT_REQUEST_ONLY_TOOLS which require an explicit selection.
	 * When undefined (pretreatment skipped), all tools pass through.
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
	readonly allToolNames: readonly string[];
	readonly toolIntegrationLabels: Readonly<Record<string, string>>;
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
	const toolIntegrationLabels: Record<string, string> = {};
	for (let i = 0; i < toolBundles.length; i++) {
		const b = toolBundles[i];
		const module = modules[i];
		if (!b || !module) continue;
		Object.assign(mergedTools, b.tools);
		for (const toolName of Object.keys(b.tools)) {
			toolIntegrationLabels[toolName] = module.displayName;
		}
	}
	const globalTools = createGlobalChatTools({
		dryRun: options?.dryRun ?? false,
		persona: options.persona,
		appliedActions: [],
	});
	Object.assign(mergedTools, globalTools);
	for (const toolName of Object.keys(globalTools)) {
		// Don't clobber an integration-owned label: some tools (e.g. webSearch)
		// are exposed both as an integration tool and a global tool. Keep the
		// integration attribution so the "Tools selected" summary is accurate.
		toolIntegrationLabels[toolName] ??= "Toby";
	}
	const memoryTools = createMemoryTools({
		userId: "default",
		dryRun: options?.dryRun ?? false,
		appliedActions: [],
	});
	Object.assign(mergedTools, memoryTools);
	for (const toolName of Object.keys(memoryTools)) {
		toolIntegrationLabels[toolName] ??= "Toby";
	}
	Object.assign(mergedTools, withAskUserTool(mergedTools, undefined));
	toolIntegrationLabels.askUser ??= "Toby";

	const catalogText = buildToolsCatalog(mergedTools);
	const allToolNames = Object.keys(mergedTools);
	const allowedToolNamesLower = new Set(
		allToolNames.map((n) => n.trim().toLowerCase()),
	);
	return {
		catalogText,
		allowedToolNamesLower,
		allToolNames,
		toolIntegrationLabels,
	};
}

/**
 * Filter merged tools to only include relevant + always-included tools.
 * When pretreatment did not run (`relevantTools` undefined), all tools pass through.
 * When pretreatment ran with an empty tool list, only always-included tools remain
 * (plus any explicit-request-only tools are still excluded).
 */
export function filterToolNamesByRelevance(
	allToolNames: readonly string[],
	relevantTools: readonly string[] | undefined,
): string[] {
	if (relevantTools === undefined) {
		return [...allToolNames];
	}
	if (relevantTools.length === 0) {
		return allToolNames.filter(
			(name) => !EXPLICIT_REQUEST_ONLY_TOOLS.has(name),
		);
	}
	const relevantLower = new Set(
		relevantTools.map((n) => n.trim().toLowerCase()),
	);
	return allToolNames.filter((name) => {
		if (EXPLICIT_REQUEST_ONLY_TOOLS.has(name)) {
			return relevantLower.has(name.trim().toLowerCase());
		}
		return (
			ALWAYS_INCLUDED_TOOLS.has(name) ||
			relevantLower.has(name.trim().toLowerCase())
		);
	});
}

function filterToolsByRelevance(
	tools: Record<string, Tool>,
	relevantTools: readonly string[] | undefined,
): Record<string, Tool> {
	if (relevantTools === undefined) {
		return tools;
	}
	const allowed = new Set(
		filterToolNamesByRelevance(Object.keys(tools), relevantTools),
	);
	const filtered: Record<string, Tool> = {};
	for (const [name, tool] of Object.entries(tools)) {
		if (allowed.has(name)) {
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
