import type { FlowInputMap, FlowOutputMap, ToolRef } from "./types";

/** How the flow picks a persona at run time. */
export type FlowPersonaSpec =
	| { readonly source: "default" }
	| { readonly source: "named"; readonly name: string }
	| { readonly source: "dashboard" };

/**
 * Serializable structured-output schema for LLM Prompter nodes.
 * Only the markdown object preset is supported today.
 */
export type FlowSchemaSpec = { readonly kind: "markdown" };

export type StoredToolExecutorNode = {
	readonly id: string;
	readonly type: "tool_executor";
	readonly tool: ToolRef;
	readonly inputs?: FlowInputMap;
	readonly outputs?: FlowOutputMap;
};

export type StoredLlmPromptHelpers = {
	/** Wrap rendered system prompt with persona instructions. Default false. */
	readonly composePersona?: boolean;
	/** Append enabled skills catalog to the system prompt. Default false. */
	readonly appendSkillsCatalog?: boolean;
};

export type StoredLlmPrompterNode = {
	readonly id: string;
	readonly type: "llm_prompter";
	readonly schema: FlowSchemaSpec;
	readonly schemaName?: string;
	readonly schemaDescription?: string;
	/** Prompt template (see prompt-template.ts). */
	readonly systemPrompt: string;
	readonly userPrompt: string;
	readonly promptHelpers?: StoredLlmPromptHelpers;
	readonly inputs?: FlowInputMap;
	readonly outputs?: FlowOutputMap;
	readonly temperature?: number;
	readonly maxOutputTokens?: number;
	readonly timeoutMs?: number;
};

export type StoredFlowNode = StoredToolExecutorNode | StoredLlmPrompterNode;

/** Bag pointer for the value destinations and the result sheet consume. */
export type FlowResultPointer = {
	readonly from: string;
	readonly path?: string;
};

export type FlowDestinationModal = {
	readonly type: "modal";
};

export type FlowDestinationEmail = {
	readonly type: "email";
	readonly to: readonly string[];
	readonly subject: string;
	readonly cc?: readonly string[];
};

export type FlowDestinationSlack = {
	readonly type: "slack";
	readonly channel: string;
};

export type FlowDashboardVariant = "runner" | "informational";

export type FlowDestinationDashboard = {
	readonly type: "dashboard";
	readonly variant: FlowDashboardVariant;
};

export type FlowDestination =
	| FlowDestinationModal
	| FlowDestinationEmail
	| FlowDestinationSlack
	| FlowDestinationDashboard;

/**
 * Fully JSON-serializable flow definition stored in SQLite.
 * Runtime execution still uses FlowDefinition after hydration.
 */
export type FlowDocument = {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	readonly persona?: FlowPersonaSpec;
	readonly nodes: readonly StoredFlowNode[];
	/** Optional bag pointer; inferred from the last node when omitted. */
	readonly result?: FlowResultPointer;
	/** What to do with the declared result after a successful run. */
	readonly destinations?: readonly FlowDestination[];
};

/** Row shape returned by the definition store (includes persistence metadata). */
export type StoredFlowRecord = {
	readonly id: string;
	readonly name: string;
	readonly description: string | null;
	readonly builtin: boolean;
	readonly document: FlowDocument;
	readonly createdAt: string;
	readonly updatedAt: string;
};
