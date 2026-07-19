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
