import { executeToolRef } from "../tool-resolve";
import type { FlowNodeRuntime, ToolExecutorNodeDefinition } from "../types";
import { FlowNodeError } from "../types";

export type ToolExecutorNodeResult = {
	readonly result: unknown;
	readonly moduleName: string;
	readonly toolName: string;
	readonly standardTool?: string;
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
	const exec = await executeToolRef(
		node.tool,
		inputs as Record<string, unknown>,
	);
	if (!exec.ok) {
		throw new FlowNodeError(node.id, exec.error, "tool_execution_failed");
	}
	return {
		result: exec.result,
		moduleName: exec.moduleName,
		toolName: exec.toolName,
		...(exec.standardTool ? { standardTool: exec.standardTool } : {}),
	};
}
