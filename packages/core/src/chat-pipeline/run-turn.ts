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
import { loadIntegrationToolBundle } from "./tool-bundle-cache";

export { clearSessionToolBundleCache } from "./tool-bundle-cache";

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
	/**
	 * Tool catalog from the prep phase of the same turn. Reuses integration tool
	 * definitions so `createChatTools` is not invoked again for the model call.
	 */
	readonly prebuiltToolCatalog?: PrebuiltToolCatalog;
};

export type PrebuiltToolCatalog = {
	readonly catalogText: string;
	readonly allowedToolNamesLower: ReadonlySet<string>;
	readonly allToolNames: readonly string[];
	readonly toolIntegrationLabels: Readonly<Record<string, string>>;
	readonly integrationTools: Record<string, Tool>;
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

function mergeAuxiliaryChatTools(
	integration: {
		readonly tools: Record<string, Tool>;
		readonly toolIntegrationLabels: Record<string, string>;
	},
	options: {
		readonly dryRun: boolean;
		readonly persona: Persona;
		readonly globalAppliedActions?: string[];
		readonly memoryAppliedActions?: string[];
	},
): {
	readonly mergedTools: Record<string, Tool>;
	readonly toolIntegrationLabels: Record<string, string>;
} {
	const mergedTools: Record<string, Tool> = { ...integration.tools };
	const toolIntegrationLabels: Record<string, string> = {
		...integration.toolIntegrationLabels,
	};

	const globalTools = createGlobalChatTools({
		dryRun: options.dryRun,
		persona: options.persona,
		appliedActions: options.globalAppliedActions ?? [],
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
		dryRun: options.dryRun,
		appliedActions: options.memoryAppliedActions ?? [],
	});
	Object.assign(mergedTools, memoryTools);
	for (const toolName of Object.keys(memoryTools)) {
		toolIntegrationLabels[toolName] ??= "Toby";
	}

	return { mergedTools, toolIntegrationLabels };
}

function buildToolCatalogFromMergedTools(
	mergedTools: Record<string, Tool>,
	toolIntegrationLabels: Record<string, string>,
	integrationTools: Record<string, Tool>,
): PrebuiltToolCatalog {
	const catalogTools = withAskUserTool(mergedTools, undefined);
	const labels = { ...toolIntegrationLabels };
	labels.askUser ??= "Toby";

	const catalogText = buildToolsCatalog(catalogTools);
	const allToolNames = Object.keys(catalogTools);
	const allowedToolNamesLower = new Set(
		allToolNames.map((n) => n.trim().toLowerCase()),
	);
	return {
		catalogText,
		allowedToolNamesLower,
		allToolNames,
		toolIntegrationLabels: labels,
		integrationTools,
	};
}

/**
 * Eagerly resolve all tools for the given modules (integration + global + memory)
 * and return a compact catalog string for pretreatment consumption.
 */
export async function buildToolsCatalogForPretreatment(
	modules: readonly IntegrationModule[],
	options: { readonly dryRun?: boolean; readonly persona: Persona },
): Promise<PrebuiltToolCatalog> {
	const dryRun = options.dryRun ?? false;
	const integration = await loadIntegrationToolBundle(modules, { dryRun });
	const { mergedTools, toolIntegrationLabels } = mergeAuxiliaryChatTools(
		integration,
		{ dryRun, persona: options.persona },
	);
	return buildToolCatalogFromMergedTools(
		mergedTools,
		toolIntegrationLabels,
		integration.tools,
	);
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
	const appliedActions: string[] = [];
	const globalAppliedSink: string[] = [];
	const memoryAppliedSink: string[] = [];

	let mergedTools: Record<string, Tool>;
	let toolIntegrationLabels: Record<string, string>;

	if (options.prebuiltToolCatalog) {
		const integrationLabels: Record<string, string> = {};
		for (const name of Object.keys(
			options.prebuiltToolCatalog.integrationTools,
		)) {
			integrationLabels[name] =
				options.prebuiltToolCatalog.toolIntegrationLabels[name] ?? "Toby";
		}
		const auxiliary = mergeAuxiliaryChatTools(
			{
				tools: options.prebuiltToolCatalog.integrationTools,
				toolIntegrationLabels: integrationLabels,
			},
			{
				dryRun: options.dryRun,
				persona: options.persona,
				globalAppliedActions: globalAppliedSink,
				memoryAppliedActions: memoryAppliedSink,
			},
		);
		mergedTools = auxiliary.mergedTools;
		toolIntegrationLabels = auxiliary.toolIntegrationLabels;
	} else {
		for (const m of modules) {
			if (!m.createChatTools) {
				throw new Error(
					`runIntegrationChatTurn: integration "${m.name}" does not export createChatTools`,
				);
			}
		}
		const integration = await loadIntegrationToolBundle(modules, {
			dryRun: options.dryRun,
			maxResults: options.maxResults,
		});
		const auxiliary = mergeAuxiliaryChatTools(integration, {
			dryRun: options.dryRun,
			persona: options.persona,
			globalAppliedActions: globalAppliedSink,
			memoryAppliedActions: memoryAppliedSink,
		});
		mergedTools = auxiliary.mergedTools;
		toolIntegrationLabels = auxiliary.toolIntegrationLabels;
	}

	appliedActions.push(...globalAppliedSink, ...memoryAppliedSink);
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
