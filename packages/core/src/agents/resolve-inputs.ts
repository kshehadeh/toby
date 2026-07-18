import type {
	AgentContextBag,
	AgentInputMap,
	AgentInputSource,
	AgentOutputMap,
} from "./types";
import { AgentNodeError } from "./types";

/** Read a simple dot-path from a value (`a.b.c`). Returns undefined if missing. */
export function getByPath(value: unknown, path: string | undefined): unknown {
	if (path === undefined || path === "" || path === ".") {
		return value;
	}
	const parts = path.split(".").filter(Boolean);
	let current: unknown = value;
	for (const part of parts) {
		if (current === null || current === undefined) return undefined;
		if (typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

function resolveSource(
	source: AgentInputSource,
	bag: Readonly<AgentContextBag>,
	nodeId: string,
	paramName: string,
): unknown {
	if ("const" in source) {
		return source.const;
	}
	if (!(source.from in bag)) {
		throw new AgentNodeError(
			nodeId,
			`Missing context key "${source.from}" for input "${paramName}"`,
			"missing_input",
		);
	}
	const root = bag[source.from];
	if (source.path === undefined || source.path === "" || source.path === ".") {
		return root;
	}
	const nested = getByPath(root, source.path);
	if (nested === undefined) {
		throw new AgentNodeError(
			nodeId,
			`Context key "${source.from}" has no path "${source.path}" for input "${paramName}"`,
			"missing_input_path",
		);
	}
	return nested;
}

/** Resolve a node's input map against the context bag. */
export function resolveNodeInputs(
	nodeId: string,
	inputs: AgentInputMap | undefined,
	bag: Readonly<AgentContextBag>,
): Record<string, unknown> {
	if (!inputs) return {};
	const resolved: Record<string, unknown> = {};
	for (const [name, source] of Object.entries(inputs)) {
		resolved[name] = resolveSource(source, bag, nodeId, name);
	}
	return resolved;
}

/**
 * Write node result fields into the context bag using an outputs map.
 * Values are paths into `nodeResult` (`.` = entire result).
 */
export function applyNodeOutputs(
	nodeId: string,
	outputs: AgentOutputMap,
	nodeResult: unknown,
	bag: AgentContextBag,
): void {
	for (const [contextKey, path] of Object.entries(outputs)) {
		const value = getByPath(nodeResult, path);
		if (value === undefined && path !== "." && path !== "") {
			throw new AgentNodeError(
				nodeId,
				`Node result has no path "${path}" for output key "${contextKey}"`,
				"missing_output_path",
			);
		}
		bag[contextKey] = value;
	}
}
