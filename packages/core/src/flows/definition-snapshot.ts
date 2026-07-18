import type {
	FlowDefinition,
	FlowDefinitionSnapshot,
	FlowInputMap,
	FlowNodeDefinition,
	FlowNodeSnapshot,
} from "./types";

function snapshotInputs(
	inputs: FlowInputMap | undefined,
): FlowNodeSnapshot["inputs"] {
	if (!inputs) return undefined;
	const out: Record<
		string,
		{ const?: unknown; from?: string; path?: string }
	> = {};
	for (const [key, source] of Object.entries(inputs)) {
		if ("const" in source) {
			out[key] = { const: source.const };
		} else {
			out[key] = {
				from: source.from,
				...(source.path !== undefined ? { path: source.path } : {}),
			};
		}
	}
	return out;
}

function snapshotNode(node: FlowNodeDefinition): FlowNodeSnapshot {
	if (node.type === "tool_executor") {
		return {
			id: node.id,
			type: "tool_executor",
			tool: node.tool,
			inputs: snapshotInputs(node.inputs),
			outputs: node.outputs,
		};
	}
	return {
		id: node.id,
		type: "llm_prompter",
		schemaName: node.schemaName,
		temperature: node.temperature,
		maxOutputTokens: node.maxOutputTokens,
		inputs: snapshotInputs(node.inputs),
		outputs: node.outputs,
	};
}

/** Serializable graph for UI (no functions or Zod schemas). */
export function buildDefinitionSnapshot(
	definition: FlowDefinition,
): FlowDefinitionSnapshot {
	return {
		name: definition.name,
		...(definition.description ? { description: definition.description } : {}),
		nodes: definition.nodes.map(snapshotNode),
	};
}
