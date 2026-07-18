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
	/** Optional caller label (e.g. `dashboard.summary:email`). */
	readonly trigger?: string;
	/**
	 * Persist this run to chat.sqlite (default true).
	 * Set false in unit tests that do not need history.
	 */
	readonly record?: boolean;
};

export type FlowNodeStatus = "running" | "success" | "error" | "skipped";
export type FlowRunStatus = "running" | "success" | "error";

export type ToolCallRecord = {
	readonly moduleName: string;
	readonly toolName: string;
	readonly standardTool?: string;
	readonly input: Record<string, unknown>;
	readonly ok: boolean;
	readonly result?: unknown;
	readonly error?: string | null;
	readonly durationMs: number;
};

export type ToolExecutorDetail = {
	readonly kind: "tool_executor";
	readonly tool: ToolRef;
	readonly resolved?: {
		readonly moduleName: string;
		readonly toolName: string;
		readonly standardTool?: string;
	};
	readonly toolCalls: readonly ToolCallRecord[];
};

export type LlmPrompterDetail = {
	readonly kind: "llm_prompter";
	readonly model: { readonly provider: string; readonly modelId: string };
	readonly personaName: string;
	readonly mode: "structured" | "freeform";
	readonly temperature: number;
	readonly maxOutputTokens: number;
	readonly schemaName?: string;
	readonly systemPrompt: string;
	readonly userPrompt: string;
	readonly usage?: {
		readonly inputTokens?: number;
		readonly outputTokens?: number;
		readonly totalTokens?: number;
	} | null;
};

export type FlowNodeDetail = ToolExecutorDetail | LlmPrompterDetail;

/** Rich per-node record for in-memory result and DB persistence. */
export type FlowNodeRecord = {
	readonly nodeId: string;
	readonly type: FlowNodeDefinition["type"];
	readonly order: number;
	readonly status: FlowNodeStatus;
	readonly durationMs: number;
	readonly startedAt: string;
	readonly completedAt?: string;
	readonly inputs: Readonly<Record<string, unknown>>;
	/** Values written into the bag for this node’s output map. */
	readonly bagWrites: Readonly<Record<string, unknown>>;
	/** Full node result object before bag mapping. */
	readonly nodeResult?: unknown;
	readonly error?: string;
	readonly detail?: FlowNodeDetail;
};

/** @deprecated Prefer FlowNodeRecord; kept as alias for compatibility. */
export type FlowNodeTrace = FlowNodeRecord;

export type FlowResult =
	| {
			readonly ok: true;
			readonly flowName: string;
			readonly persona: Persona;
			readonly provider: string;
			readonly model: string;
			readonly outputs: Readonly<FlowContextBag>;
			readonly nodeTrace: readonly FlowNodeRecord[];
			readonly runId?: string;
			readonly startedAt: string;
			readonly completedAt: string;
			readonly durationMs: number;
	  }
	| {
			readonly ok: false;
			readonly flowName: string;
			readonly persona?: Persona;
			readonly provider?: string;
			readonly model?: string;
			readonly outputs: Readonly<FlowContextBag>;
			readonly nodeTrace: readonly FlowNodeRecord[];
			readonly error: string;
			readonly failedNodeId?: string;
			readonly runId?: string;
			readonly startedAt: string;
			readonly completedAt: string;
			readonly durationMs: number;
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

// --- Definition snapshot (UI graph, no functions/Zod) ---

export type FlowNodeSnapshot = {
	readonly id: string;
	readonly type: FlowNodeDefinition["type"];
	readonly tool?: ToolRef;
	readonly schemaName?: string;
	readonly temperature?: number;
	readonly maxOutputTokens?: number;
	readonly inputs?: Readonly<
		Record<string, { const?: unknown; from?: string; path?: string }>
	>;
	readonly outputs?: FlowOutputMap;
};

export type FlowDefinitionSnapshot = {
	readonly name: string;
	readonly description?: string;
	readonly nodes: readonly FlowNodeSnapshot[];
};

// --- Persisted history API types ---

export type FlowRunSummary = {
	readonly id: string;
	readonly flowName: string;
	readonly status: FlowRunStatus;
	readonly personaName: string | null;
	readonly provider: string | null;
	readonly model: string | null;
	readonly trigger: string | null;
	readonly error: string | null;
	readonly failedNodeId: string | null;
	readonly startedAt: string;
	readonly completedAt: string | null;
	readonly durationMs: number | null;
};

export type FlowRunNodeDetail = {
	readonly id: string;
	readonly runId: string;
	readonly nodeId: string;
	readonly nodeType: FlowNodeDefinition["type"];
	readonly nodeOrder: number;
	readonly status: FlowNodeStatus;
	readonly inputs: unknown;
	readonly outputs: unknown;
	readonly error: string | null;
	readonly durationMs: number | null;
	readonly startedAt: string | null;
	readonly completedAt: string | null;
	readonly detail: unknown;
};

export type FlowRunDetail = FlowRunSummary & {
	readonly definitionSnapshot: FlowDefinitionSnapshot;
	readonly initialInputs: unknown;
	readonly finalOutputs: unknown;
	readonly nodes: readonly FlowRunNodeDetail[];
};
