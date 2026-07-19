import {
	deleteFlowDocument,
	getFlowRecord,
	listFlowRecords,
	upsertFlowDocument,
} from "./definition-store";
import type { FlowDocument } from "./document-types";
import { hydrateFlowDocument } from "./hydrate";
import type { FlowDefinition } from "./types";

/**
 * Look up a flow by id (seeds built-ins on first miss).
 * Returns a hydrated runtime definition.
 */
export function getFlow(name: string): FlowDefinition | undefined {
	const record = getFlowRecord(name);
	if (!record) return undefined;
	return hydrateFlowDocument(record.document);
}

/** List all stored flows (ensures built-ins are seeded), name-sorted. */
export function listFlows(): readonly FlowDefinition[] {
	return listFlowRecords().map((record) =>
		hydrateFlowDocument(record.document),
	);
}

/**
 * Persist a serializable flow document (create or replace).
 * Prefer this over legacy runtime-only registration.
 */
export function saveFlowDocument(
	document: FlowDocument,
	options?: { readonly builtin?: boolean },
): FlowDefinition {
	const record = upsertFlowDocument(document, options);
	return hydrateFlowDocument(record.document);
}

/** Remove a stored flow definition. */
export function removeFlowDocument(id: string): boolean {
	return deleteFlowDocument(id);
}

/**
 * @deprecated Prefer saveFlowDocument with a FlowDocument.
 * Kept for tests that still construct runtime-only tool_executor graphs:
 * those cannot be fully rehydrated (no prompt templates). For tool-only
 * flows used in unit tests, use runFlowDefinition instead of registration.
 */
export function registerFlow(definition: FlowDefinition): void {
	// Best-effort: only tool_executor nodes can be stored without templates.
	const nodes = definition.nodes.map((node) => {
		if (node.type === "tool_executor") {
			return {
				id: node.id,
				type: "tool_executor" as const,
				tool: node.tool,
				...(node.inputs ? { inputs: node.inputs } : {}),
				...(node.outputs ? { outputs: node.outputs } : {}),
			};
		}
		throw new Error(
			`registerFlow cannot persist llm_prompter nodes for "${definition.name}". Use saveFlowDocument with string prompt templates, or runFlowDefinition for in-memory runs.`,
		);
	});

	const document: FlowDocument = {
		id: definition.name.trim(),
		name: definition.name.trim(),
		...(definition.description ? { description: definition.description } : {}),
		...(definition.personaName
			? { persona: { source: "named", name: definition.personaName } }
			: {}),
		nodes,
	};

	upsertFlowDocument(document, { builtin: false });
}

/**
 * Test helper: no-op for API compatibility.
 * Use isolated TOBY_DIR + closeChatDbForTests() for clean DB state.
 */
export function clearFlowRegistry(): void {
	// Intentionally empty — definitions live in SQLite, not an in-memory Map.
}
