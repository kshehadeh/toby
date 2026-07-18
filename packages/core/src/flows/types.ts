import type { z } from "zod";
import type { Persona } from "../config/index";

/** How a node input is sourced from literals or prior context. */
export type FlowInputSource =
	| { readonly const: unknown }
	| {
			/** Context bag key written by a previous node or initial input. */
			readonly from: string;
			/** Optional simple dot-path into that value (e.g. `"items"` or `"result.count"`). */
			readonly path?: string;
	  };

/** Map of node parameter name → source. */
export type FlowInputMap = Readonly<Record<string, FlowInputSource>>;

/**
 * Map of context bag key → path into the node result object.
 * Use `"."` (or empty) to store the entire node result under that key.
 */
export type FlowOutputMap = Readonly<Record<string, string>>;

export type ToolRef =
	| { readonly standardTool: string }
	| { readonly moduleName: string; readonly toolName: string };

export type ToolExecutorNodeDefinition = {
	readonly id: string;
	readonly type: "tool_executor";
	readonly tool: ToolRef;
	readonly inputs?: FlowInputMap;
	/** Defaults to `{ result: "result" }` (tool result under key `result`). */
	readonly outputs?: FlowOutputMap;
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
	readonly systemPrompt: (ctx: FlowNodePromptContext) => string;
	readonly userPrompt: (ctx: FlowNodePromptContext) => string;
	readonly inputs?: FlowInputMap;
	/** Defaults to `{ object: "object" }`. */
	readonly outputs?: FlowOutputMap;
	readonly temperature?: number;
	readonly maxOutputTokens?: number;
	readonly timeoutMs?: number;
};

export type FlowNodeDefinition =
	| ToolExecutorNodeDefinition
	| LlmPrompterNodeDefinition;

export type FlowDefinition = {
	readonly name: string;
	readonly description?: string;
	/** Fixed persona name from config (if set). */
	readonly personaName?: string;
	/** Dynamic persona resolve (e.g. dashboard settings). */
	readonly resolvePersona?: () => Persona;
	readonly nodes: readonly FlowNodeDefinition[];
};

/** Mutable bag of intermediate values during a run. */
export type FlowContextBag = Record<string, unknown>;

export type FlowNodePromptContext = {
	readonly persona: Persona;
	readonly bag: Readonly<FlowContextBag>;
	/** Resolved inputs for this node (from `inputs` map). */
	readonly inputs: Readonly<Record<string, unknown>>;
};

export type FlowRunOptions = {
	readonly inputs?: Readonly<Record<string, unknown>>;
	readonly personaOverride?: Persona;
	readonly abortSignal?: AbortSignal;
};

export type FlowNodeTrace = {
	readonly nodeId: string;
	readonly type: FlowNodeDefinition["type"];
	readonly durationMs: number;
	readonly ok: boolean;
	readonly error?: string;
};

export type FlowResult =
	| {
			readonly ok: true;
			readonly flowName: string;
			readonly persona: Persona;
			readonly outputs: Readonly<FlowContextBag>;
			readonly nodeTrace: readonly FlowNodeTrace[];
	  }
	| {
			readonly ok: false;
			readonly flowName: string;
			readonly persona?: Persona;
			readonly outputs: Readonly<FlowContextBag>;
			readonly nodeTrace: readonly FlowNodeTrace[];
			readonly error: string;
			readonly failedNodeId?: string;
	  };

export class FlowNodeError extends Error {
	readonly nodeId: string;
	readonly code: string;

	constructor(nodeId: string, message: string, code = "node_error") {
		super(message);
		this.name = "FlowNodeError";
		this.nodeId = nodeId;
		this.code = code;
	}
}

/** Internal runtime passed to node implementations. */
export type FlowNodeRuntime = {
	readonly persona: Persona;
	readonly bag: FlowContextBag;
	readonly abortSignal?: AbortSignal;
};
