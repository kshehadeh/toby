import type { AgentDefinition } from "./types";

const agents = new Map<string, AgentDefinition>();

/** Register (or replace) a code-defined agent. */
export function registerAgent(definition: AgentDefinition): void {
	const name = definition.name.trim();
	if (!name) {
		throw new Error("Agent definition must have a non-empty name");
	}
	if (definition.nodes.length === 0) {
		throw new Error(`Agent "${name}" must have at least one node`);
	}
	const ids = new Set<string>();
	for (const node of definition.nodes) {
		if (!node.id.trim()) {
			throw new Error(`Agent "${name}" has a node with an empty id`);
		}
		if (ids.has(node.id)) {
			throw new Error(`Agent "${name}" has duplicate node id "${node.id}"`);
		}
		ids.add(node.id);
	}
	agents.set(name, definition);
}

/** Look up a registered agent by name. */
export function getAgent(name: string): AgentDefinition | undefined {
	return agents.get(name.trim());
}

/** List all registered agents (stable name sort). */
export function listAgents(): readonly AgentDefinition[] {
	return [...agents.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Clear the registry (tests only). */
export function clearAgentRegistry(): void {
	agents.clear();
}
