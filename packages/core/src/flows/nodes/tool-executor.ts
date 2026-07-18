import { executeToolRef } from "../tool-resolve";
import type {
	FlowNodeRuntime,
	ToolExecutorDetail,
	ToolExecutorNodeDefinition,
} from "../types";
import { FlowNodeError } from "../types";

export type ToolExecutorNodeResult = {
	readonly result: unknown;
	readonly moduleName: string;
	readonly toolName: string;
	readonly standardTool?: string;
	readonly detail: ToolExecutorDetail;
};

const DEFAULT_OUTPUTS = { result: "result" } as const;

export function defaultToolExecutorOutputs(): typeof DEFAULT_OUTPUTS {
	return DEFAULT_OUTPUTS;
}

export async function runToolExecutorNode(
	node: ToolExecutorNodeDefinition,
	inputs: Readonly<Record<string, unknown>>,
	_runtime: FlowNodeRuntime,
): Promise<ToolExecutorNodeResult> {
	const started = Date.now();
	const exec = await executeToolRef(
		node.tool,
		inputs as Record<string, unknown>,
	);
	const durationMs = Date.now() - started;

	if (!exec.ok) {
		const detail: ToolExecutorDetail = {
			kind: "tool_executor",
			tool: node.tool,
			...(exec.moduleName && exec.toolName
				? {
						resolved: {
							moduleName: exec.moduleName,
							toolName: exec.toolName,
							...(exec.standardTool ? { standardTool: exec.standardTool } : {}),
						},
					}
				: {}),
			toolCalls: [
				{
					moduleName: exec.moduleName ?? "",
					toolName: exec.toolName ?? "",
					...(exec.standardTool ? { standardTool: exec.standardTool } : {}),
					input: inputs as Record<string, unknown>,
					ok: false,
					error: exec.error,
					durationMs,
				},
			],
		};
		const error = new FlowNodeError(
			node.id,
			exec.error,
			"tool_execution_failed",
		) as FlowNodeError & { detail?: ToolExecutorDetail };
		error.detail = detail;
		throw error;
	}

	const detail: ToolExecutorDetail = {
		kind: "tool_executor",
		tool: node.tool,
		resolved: {
			moduleName: exec.moduleName,
			toolName: exec.toolName,
			...(exec.standardTool ? { standardTool: exec.standardTool } : {}),
		},
		toolCalls: [
			{
				moduleName: exec.moduleName,
				toolName: exec.toolName,
				...(exec.standardTool ? { standardTool: exec.standardTool } : {}),
				input: inputs as Record<string, unknown>,
				ok: true,
				result: exec.result,
				error: null,
				durationMs,
			},
		],
	};

	return {
		result: exec.result,
		moduleName: exec.moduleName,
		toolName: exec.toolName,
		...(exec.standardTool ? { standardTool: exec.standardTool } : {}),
		detail,
	};
}
