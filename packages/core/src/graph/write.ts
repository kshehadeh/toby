import { getDb } from "../memory/memory-store";
import { enqueueEnrichment, upsertEdgeByIds, upsertNode } from "./store";
import type {
	GraphNodeInput,
	GraphWriteInput,
	GraphWriteResult,
} from "./types";

function refKey(n: GraphNodeInput): string {
	return `${n.type}\u0000${n.key}`;
}

/**
 * Write nodes and their deterministic edges in one transaction, then queue
 * enrichment (semantic + extracted edges) for the primary nodes. Edge
 * endpoints are upserted by (type, key), so callers never look up ids.
 */
export function writeGraph(input: GraphWriteInput): GraphWriteResult {
	const db = getDb();
	const ts = new Date().toISOString();
	const run = db.transaction(() => {
		const ids = new Map<string, string>();
		const idFor = (n: GraphNodeInput): string => {
			const k = refKey(n);
			const known = ids.get(k);
			if (known) return known;
			const id = upsertNode(n, ts);
			ids.set(k, id);
			return id;
		};
		const nodeIds = (input.nodes ?? []).map((n) => {
			const id = upsertNode(n, ts);
			ids.set(refKey(n), id);
			return id;
		});
		const edgeIds: string[] = [];
		for (const edge of input.edges ?? []) {
			const id = upsertEdgeByIds(idFor(edge.src), idFor(edge.dst), edge, ts);
			if (id) edgeIds.push(id);
		}
		if (input.enrich?.length) {
			for (const id of nodeIds) enqueueEnrichment(id, input.enrich, ts);
		}
		return { nodeIds, edgeIds };
	});
	return run();
}
