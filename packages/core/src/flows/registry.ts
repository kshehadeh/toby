import type { FlowDefinition } from "./types";

const flows = new Map<string, FlowDefinition>();

/** Register (or replace) a code-defined flow. */
export function registerFlow(definition: FlowDefinition): void {
	const name = definition.name.trim();
	if (!name) {
		throw new Error("Flow definition must have a non-empty name");
	}
	if (definition.nodes.length === 0) {
		throw new Error(`Flow "${name}" must have at least one node`);
	}
	const ids = new Set<string>();
	for (const node of definition.nodes) {
		if (!node.id.trim()) {
			throw new Error(`Flow "${name}" has a node with an empty id`);
		}
		if (ids.has(node.id)) {
			throw new Error(`Flow "${name}" has duplicate node id "${node.id}"`);
		}
		ids.add(node.id);
	}
	flows.set(name, definition);
}

/** Look up a registered flow by name. */
export function getFlow(name: string): FlowDefinition | undefined {
	return flows.get(name.trim());
}

/** List all registered flows (stable name sort). */
export function listFlows(): readonly FlowDefinition[] {
	return [...flows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Clear the registry (tests only). */
export function clearFlowRegistry(): void {
	flows.clear();
}
