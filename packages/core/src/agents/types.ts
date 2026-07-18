import type { z } from "zod";
import type { Persona } from "../config/index";

/** How a node input is sourced from literals or prior context. */
export type AgentInputSource =
	| { readonly const: unknown }
	| {
			/** Context bag key written by a previous node or initial input. */
			readonly from: string;
			/** Optional simple dot-path into that value (e.g. `"items"` or `"result.count"`). */
			readonly path?: string;
	  };

/** Map of node parameter name → source. */
export type AgentInputMap = Readonly<Record<string, AgentInputSource>>;

/**
 * Map of context bag key → path into the node result object.
 * Use `"."` (or empty) to store the entire node result under that key.
 */
export type AgentOutputMap = Readonly<Record<string, string>>;

export type ToolRef =
	| { readonly standardTool: string }
	| { readonly moduleName: string; readonly toolName: string };

export type ToolExecutorNodeDefinition = {
	readonly id: string;
	readonly type: "tool_executor";
	readonly tool: ToolRef;
	readonly inputs?: AgentInputMap;
	/** Defaults to `{ result: "result" }` (tool result under key `result`). */
	readonly outputs?: AgentOutputMap;
};

export type LlmPrompterNodeDefinition<
	TSchema extends z.ZodTypeAny = z.ZodTypeAny,
> = {
	readonly id: string;
	readonly type: "llm_prompter";
	/** Zod schema for structured model output (always required). */
	readonly schema: TSchema;
	/** Optional name passed to Output.object. */
	readonly schemaName?: string;
	readonly schemaDescription?: string;
	readonly systemPrompt: (ctx: AgentNodePromptContext) => string;
	readonly userPrompt: (ctx: AgentNodePromptContext) => string;
	readonly inputs?: AgentInputMap;
	/** Defaults to `{ object: "object" }`. */
	readonly outputs?: AgentOutputMap;
	readonly temperature?: number;
	readonly maxOutputTokens?: number;
	readonly timeoutMs?: number;
};

export type AgentNodeDefinition =
	| ToolExecutorNodeDefinition
	| LlmPrompterNodeDefinition;

export type AgentDefinition = {
	readonly name: string;
	readonly description?: string;
	/** Fixed persona name from config (if set). */
	readonly personaName?: string;
	/** Dynamic persona resolve (e.g. dashboard settings). */
	readonly resolvePersona?: () => Persona;
	readonly nodes: readonly AgentNodeDefinition[];
};

/** Mutable bag of intermediate values during a run. */
export type AgentContextBag = Record<string, unknown>;

export type AgentNodePromptContext = {
	readonly persona: Persona;
	readonly bag: Readonly<AgentContextBag>;
	/** Resolved inputs for this node (from `inputs` map). */
	readonly inputs: Readonly<Record<string, unknown>>;
};

export type AgentRunOptions = {
	readonly inputs?: Readonly<Record<string, unknown>>;
	readonly personaOverride?: Persona;
	readonly abortSignal?: AbortSignal;
};

export type AgentNodeTrace = {
	readonly nodeId: string;
	readonly type: AgentNodeDefinition["type"];
	readonly durationMs: number;
	readonly ok: boolean;
	readonly error?: string;
};

export type AgentResult =
	| {
			readonly ok: true;
			readonly agentName: string;
			readonly persona: Persona;
			readonly outputs: Readonly<AgentContextBag>;
			readonly nodeTrace: readonly AgentNodeTrace[];
	  }
	| {
			readonly ok: false;
			readonly agentName: string;
			readonly persona?: Persona;
			readonly outputs: Readonly<AgentContextBag>;
			readonly nodeTrace: readonly AgentNodeTrace[];
			readonly error: string;
			readonly failedNodeId?: string;
	  };

export class AgentNodeError extends Error {
	readonly nodeId: string;
	readonly code: string;

	constructor(nodeId: string, message: string, code = "node_error") {
		super(message);
		this.name = "AgentNodeError";
		this.nodeId = nodeId;
		this.code = code;
	}
}

/** Internal runtime passed to node implementations. */
export type AgentNodeRuntime = {
	readonly persona: Persona;
	readonly bag: AgentContextBag;
	readonly abortSignal?: AbortSignal;
};
