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
import { log, logWithSession } from "../logging/chat-log";
import { createMemoryTools } from "../memory/tools";
import { injectCurrentDateTimeIntoFirstSystemMessage } from "../prepare-messages";
import type { Project } from "../projects/index";
import type { ValidatedChatAttachment } from "./attachments";
import type { ChatEvent, ChatEventSink } from "./chat-events";
import { loadIntegrationToolBundle } from "./tool-bundle-cache";

export { clearSessionToolBundleCache } from "./tool-bundle-cache";

/**
 * Measure the character length of a CoreMessage's content.
 */
function messageContentChars(msg: CoreMessage): number {
	const content = msg.content;
	if (typeof content === "string") return content.length;
	if (Array.isArray(content)) {
		return (content as readonly unknown[]).reduce<number>((sum, part) => {
			if (typeof part === "string") return sum + part.length;
			if (part && typeof part === "object" && "text" in part) {
				return sum + String((part as { text: string }).text).length;
			}
			return sum;
		}, 0);
	}
	return 0;
}

/**
 * Compute prompt size metrics for logging.
 */
function computePromptSizeMetrics(messages: readonly CoreMessage[]) {
	let systemChars = 0;
	let userChars = 0;
	let assistantChars = 0;
	let toolChars = 0;
	let totalChars = 0;

	for (const msg of messages) {
		const chars = messageContentChars(msg);
		totalChars += chars;
		switch (msg.role) {
			case "system":
				systemChars += chars;
				break;
			case "user":
				userChars += chars;
				break;
			case "assistant":
				assistantChars += chars;
				break;
			case "tool":
				toolChars += chars;
				break;
		}
	}

	return {
		messageCount: messages.length,
		systemChars,
		userChars,
		assistantChars,
		toolChars,
		totalChars,
		estimatedTokens: Math.ceil(totalChars / 4),
	};
}

/**
 * Tools that are always included regardless of pretreatment tool selection.
 * Only truly essential tools for the chat flow itself are here; memory, web,
 * listen, and reflection tools are routed by pretreatment/semantic routing
 * to reduce tool-schema bloat and improve first-token latency.
 */
const ALWAYS_INCLUDED_TOOLS: ReadonlySet<string> = new Set([
	"askUser",
	"getCurrentDateTime",
	"loadLocalSkillInstructions",
	"writeTextFile",
	"tobyListIntegrations",
	"tobyListTools",
	"tobyListSkills",
	"delegateToSubAgent",
	"memorySearch",
	"memoryPropose",
	"memorySave",
	"saveProjectAttachment",
	"listProjectFiles",
	"createProjectFolder",
	"renameProjectFile",
	"deleteProjectFile",
	"readPdf",
]);

export { ALWAYS_INCLUDED_TOOLS };

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
	readonly project?: Project | null;
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
	/** Validated files attached to the current turn, available to project-only tools. */
	readonly attachments?: readonly ValidatedChatAttachment[];
	/**
	 * Tool catalog from the prep phase of the same turn. Reuses integration tool
	 * definitions so `createChatTools` is not invoked again for the model call.
	 */
	readonly prebuiltToolCatalog?: PrebuiltToolCatalog;
	/** Session ID for log attribution. */
	readonly sessionId?: string;
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
		readonly project?: Project | null;
		readonly globalAppliedActions?: string[];
		readonly memoryAppliedActions?: string[];
		readonly abortSignal?: AbortSignal;
		readonly emit?: ChatEventSink;
		readonly nextSeq?: () => number;
		readonly sessionId?: string;
		readonly attachments?: readonly ValidatedChatAttachment[];
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
		project: options.project ?? null,
		abortSignal: options.abortSignal,
		emit: options.emit,
		nextSeq: options.nextSeq,
		sessionId: options.sessionId,
		attachments: options.attachments,
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
	options: {
		readonly dryRun?: boolean;
		readonly persona: Persona;
		readonly project?: Project | null;
	},
): Promise<PrebuiltToolCatalog> {
	const dryRun = options.dryRun ?? false;
	const integration = await loadIntegrationToolBundle(modules, { dryRun });
	const { mergedTools, toolIntegrationLabels } = mergeAuxiliaryChatTools(
		integration,
		{ dryRun, persona: options.persona, project: options.project ?? null },
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

	// Sequence counter for sub-agent event emission.
	let subAgentSeq = 0;
	const subAgentNextSeq = () => {
		subAgentSeq += 1;
		return subAgentSeq;
	};

	const abortSignal = options.chatWithToolsOptions?.abortSignal;
	const emit = options.chatWithToolsOptions?.onChatEvent;

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
				project: options.project ?? null,
				globalAppliedActions: globalAppliedSink,
				memoryAppliedActions: memoryAppliedSink,
				abortSignal,
				emit,
				nextSeq: subAgentNextSeq,
				sessionId: options.sessionId,
				attachments: options.attachments,
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
			project: options.project ?? null,
			globalAppliedActions: globalAppliedSink,
			memoryAppliedActions: memoryAppliedSink,
			abortSignal,
			emit,
			nextSeq: subAgentNextSeq,
			sessionId: options.sessionId,
			attachments: options.attachments,
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
	const sid = options.sessionId ?? null;
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
	const promptMetrics = computePromptSizeMetrics(messagesForModel);
	logWithSession(sid, undefined, "info", "turn", "turn_start", {
		modules: moduleNames,
		messageCount: promptMetrics.messageCount,
		toolCount: Object.keys(tools).length,
		totalToolsAvailable: Object.keys(mergedTools).length,
		relevantTools: options.relevantTools ?? [],
		selectedToolNames: Object.keys(tools),
		model: options.persona.ai.model,
		systemChars: promptMetrics.systemChars,
		userChars: promptMetrics.userChars,
		assistantChars: promptMetrics.assistantChars,
		toolChars: promptMetrics.toolChars,
		totalChars: promptMetrics.totalChars,
		estimatedPromptTokens: promptMetrics.estimatedTokens,
	});
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

	logWithSession(sid, undefined, "info", "turn", "turn_end", {
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
