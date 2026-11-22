import { randomUUID } from "node:crypto";
import { getDb } from "../memory/memory-store";
import type { MemorySensitivity, MemoryVisibility } from "../memory/types";
import {
	type GraphEdge,
	type GraphEdgeInput,
	type GraphEdgeOrigin,
	type GraphEdgeType,
	type GraphEnrichStep,
	type GraphNode,
	type GraphNodeInput,
	type GraphNodeRef,
	type GraphNodeType,
	SYMMETRIC_EDGE_TYPES,
} from "./types";

export type NodeRow = {
	id: string;
	type: string;
	key: string;
	label: string;
	props_json: string;
	sensitivity: string;
	visibility: string;
	ref_table: string | null;
	ref_id: string | null;
	created_at: string;
	updated_at: string;
};

export type EdgeRow = {
	id: string;
	src: string;
	dst: string;
	type: string;
	weight: number;
	confidence: number;
	origin: string;
	occurrences: number;
	provenance_node_id: string | null;
	reason: string | null;
	created_at: string;
	updated_at: string;
};

export const NODE_COLUMNS =
	"id, type, key, label, props_json, sensitivity, visibility, ref_table, ref_id, created_at, updated_at";
export const EDGE_COLUMNS =
	"id, src, dst, type, weight, confidence, origin, occurrences, provenance_node_id, reason, created_at, updated_at";

function nowIso(): string {
	return new Date().toISOString();
}

function clamp01(value: number | undefined, fallback: number): number {
	if (value === undefined || !Number.isFinite(value)) return fallback;
	return Math.min(1, Math.max(0, value));
}

function parseProps(json: string): Record<string, unknown> {
	try {
		const value = JSON.parse(json) as unknown;
		return value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

export function rowToNode(r: NodeRow): GraphNode {
	return {
		id: r.id,
		type: r.type as GraphNodeType,
		key: r.key,
		label: r.label,
		props: parseProps(r.props_json),
		sensitivity: r.sensitivity as MemorySensitivity,
		visibility: r.visibility as MemoryVisibility,
		...(r.ref_table && r.ref_id
			? { ref: { table: r.ref_table, id: r.ref_id } }
			: {}),
		createdAt: r.created_at,
		updatedAt: r.updated_at,
	};
}

export function rowToEdge(r: EdgeRow): GraphEdge {
	return {
		id: r.id,
		src: r.src,
		dst: r.dst,
		type: r.type as GraphEdgeType,
		weight: r.weight,
		confidence: r.confidence,
		origin: r.origin as GraphEdgeOrigin,
		occurrences: r.occurrences,
		...(r.provenance_node_id ? { provenanceNodeId: r.provenance_node_id } : {}),
		...(r.reason ? { reason: r.reason } : {}),
		createdAt: r.created_at,
		updatedAt: r.updated_at,
	};
}

export function getNode(id: string): GraphNode | null {
	const row = getDb()
		.query(`SELECT ${NODE_COLUMNS} FROM graph_nodes WHERE id = $id`)
		.get({ $id: id }) as NodeRow | undefined;
	return row ? rowToNode(row) : null;
}

export function findNode(ref: GraphNodeRef): GraphNode | null {
	const row = getDb()
		.query(
			`SELECT ${NODE_COLUMNS} FROM graph_nodes WHERE type = $type AND key = $key`,
		)
		.get({ $type: ref.type, $key: ref.key }) as NodeRow | undefined;
	return row ? rowToNode(row) : null;
}

export function getNodes(ids: readonly string[]): GraphNode[] {
	if (ids.length === 0) return [];
	const out: GraphNode[] = [];
	const db = getDb();
	for (let i = 0; i < ids.length; i += 400) {
		const chunk = ids.slice(i, i + 400);
		const params: Record<string, unknown> = {};
		const marks = chunk.map((id, j) => {
			params[`$n${j}`] = id;
			return `$n${j}`;
		});
		const rows = db
			.query(
				`SELECT ${NODE_COLUMNS} FROM graph_nodes WHERE id IN (${marks.join(",")})`,
			)
			.all(params) as NodeRow[];
		out.push(...rows.map(rowToNode));
	}
	return out;
}

export function listNodes(params: {
	readonly type?: GraphNodeType;
	readonly updatedSince?: string;
	readonly limit?: number;
}): GraphNode[] {
	const where: string[] = [];
	const args: Record<string, unknown> = {
		$limit: Math.max(1, Math.min(10_000, params.limit ?? 500)),
	};
	if (params.type) {
		where.push("type = $type");
		args.$type = params.type;
	}
	if (params.updatedSince) {
		where.push("updated_at >= $since");
		args.$since = params.updatedSince;
	}
	const rows = getDb()
		.query(
			`SELECT ${NODE_COLUMNS} FROM graph_nodes ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT $limit`,
		)
		.all(args) as NodeRow[];
	return rows.map(rowToNode);
}

/** Bounded case-insensitive label search for chat's entity lookup. */
export function searchNodesByLabel(query: string, limit = 20): GraphNode[] {
	const needle = query.trim();
	if (!needle) return [];
	const rows = getDb()
		.query(
			`SELECT ${NODE_COLUMNS} FROM graph_nodes
       WHERE label LIKE $query ESCAPE '!' AND visibility = 'usable_by_ai'
       ORDER BY CASE WHEN lower(label) = lower($exact) THEN 0 ELSE 1 END, updated_at DESC
       LIMIT $limit`,
		)
		.all({
			$query: `%${needle.replace(/[!%_]/g, (c) => `!${c}`)}%`,
			$exact: needle,
			$limit: Math.max(1, Math.min(100, limit)),
		}) as NodeRow[];
	return rows.map(rowToNode);
}

/** Insert or update by (type, key). Props are shallow-merged; provided labels and privacy win. */
export function upsertNode(input: GraphNodeInput, ts = nowIso()): string {
	const db = getDb();
	const existing = db
		.query(
			"SELECT id, label, props_json FROM graph_nodes WHERE type = $type AND key = $key",
		)
		.get({ $type: input.type, $key: input.key }) as
		| { id: string; label: string; props_json: string }
		| undefined;
	const label = input.label?.trim();
	if (!existing) {
		const id = randomUUID();
		db.query(
			`INSERT INTO graph_nodes (${NODE_COLUMNS})
       VALUES ($id, $type, $key, $label, $props, $sens, $vis, $rt, $ri, $ts, $ts)`,
		).run({
			$id: id,
			$type: input.type,
			$key: input.key,
			$label: label || input.key,
			$props: JSON.stringify(input.props ?? {}),
			$sens: input.sensitivity ?? "normal",
			$vis: input.visibility ?? "usable_by_ai",
			$rt: input.ref?.table ?? null,
			$ri: input.ref?.id ?? null,
			$ts: ts,
		});
		return id;
	}
	const sets = ["updated_at = $ts"];
	const args: Record<string, unknown> = { $id: existing.id, $ts: ts };
	if (label) {
		sets.push("label = $label");
		args.$label = label;
	}
	if (input.props && Object.keys(input.props).length > 0) {
		sets.push("props_json = $props");
		args.$props = JSON.stringify({
			...parseProps(existing.props_json),
			...input.props,
		});
	}
	if (input.sensitivity) {
		sets.push("sensitivity = $sens");
		args.$sens = input.sensitivity;
	}
	if (input.visibility) {
		sets.push("visibility = $vis");
		args.$vis = input.visibility;
	}
	if (input.ref) {
		sets.push("ref_table = $rt", "ref_id = $ri");
		args.$rt = input.ref.table;
		args.$ri = input.ref.id;
	}
	db.query(`UPDATE graph_nodes SET ${sets.join(", ")} WHERE id = $id`).run(
		args,
	);
	return existing.id;
}

/** Insert or strengthen an edge between two existing node ids. */
export function upsertEdgeByIds(
	srcId: string,
	dstId: string,
	edge: Omit<GraphEdgeInput, "src" | "dst">,
	ts = nowIso(),
): string | null {
	if (srcId === dstId) return null;
	let src = srcId;
	let dst = dstId;
	if (SYMMETRIC_EDGE_TYPES.has(edge.type) && dst < src) {
		[src, dst] = [dst, src];
	}
	const db = getDb();
	const weight = clamp01(edge.weight, 1);
	const confidence = clamp01(edge.confidence, 1);
	const existing = db
		.query(
			"SELECT id, weight, confidence FROM graph_edges WHERE src = $src AND dst = $dst AND type = $type",
		)
		.get({ $src: src, $dst: dst, $type: edge.type }) as
		| { id: string; weight: number; confidence: number }
		| undefined;
	if (existing) {
		db.query(
			`UPDATE graph_edges SET weight = $w, confidence = $c, reason = COALESCE($reason, reason), occurrences = occurrences + 1, updated_at = $ts
       WHERE id = $id`,
		).run({
			$id: existing.id,
			$w: Math.max(existing.weight, weight),
			$c: Math.max(existing.confidence, confidence),
			$ts: ts,
			$reason: edge.reason ?? null,
		});
		return existing.id;
	}
	const id = randomUUID();
	db.query(
		`INSERT INTO graph_edges (${EDGE_COLUMNS})
			 VALUES ($id, $src, $dst, $type, $w, $c, $origin, 1, $prov, $reason, $ts, $ts)`,
	).run({
		$id: id,
		$src: src,
		$dst: dst,
		$type: edge.type,
		$w: weight,
		$c: confidence,
		$origin: edge.origin ?? "deterministic",
		$prov: edge.provenanceNodeId ?? null,
		$reason: edge.reason ?? null,
		$ts: ts,
	});
	return id;
}

export function getEdge(id: string): GraphEdge | null {
	const row = getDb()
		.query(`SELECT ${EDGE_COLUMNS} FROM graph_edges WHERE id = $id`)
		.get({ $id: id }) as EdgeRow | undefined;
	return row ? rowToEdge(row) : null;
}

/** Edges touching any of `ids`, strongest and newest first, at most `fanout` per node. */
export function edgesTouching(
	ids: readonly string[],
	opts: {
		readonly edgeTypes?: readonly GraphEdgeType[];
		readonly minWeight?: number;
		readonly minConfidence?: number;
		readonly fanout?: number;
	} = {},
): GraphEdge[] {
	if (ids.length === 0) return [];
	const db = getDb();
	const fanout = Math.max(1, opts.fanout ?? 50);
	const typeArgs: Record<string, unknown> = {};
	const typeClause = opts.edgeTypes?.length
		? `AND type IN (${opts.edgeTypes
				.map((t, i) => {
					typeArgs[`$t${i}`] = t;
					return `$t${i}`;
				})
				.join(",")})`
		: "";
	const out: GraphEdge[] = [];
	const select = db.query(
		`SELECT ${EDGE_COLUMNS} FROM (
       SELECT ${EDGE_COLUMNS} FROM graph_edges WHERE src = $id AND weight >= $minW AND confidence >= $minC ${typeClause}
       UNION ALL
       SELECT ${EDGE_COLUMNS} FROM graph_edges WHERE dst = $id AND weight >= $minW AND confidence >= $minC ${typeClause}
     ) ORDER BY weight DESC, updated_at DESC LIMIT $fanout`,
	);
	for (const id of ids) {
		const rows = select.all({
			$id: id,
			$minW: opts.minWeight ?? 0,
			$minC: opts.minConfidence ?? 0,
			$fanout: fanout,
			...typeArgs,
		}) as EdgeRow[];
		out.push(...rows.map(rowToEdge));
	}
	return out;
}

/** Delete a node with its edges, embedding, and queue entry. */
export function deleteNode(id: string): boolean {
	const db = getDb();
	db.query(
		"DELETE FROM graph_edges WHERE src = $id OR dst = $id OR provenance_node_id = $id",
	).run({
		$id: id,
	});
	db.query("DELETE FROM graph_embeddings WHERE node_id = $id").run({ $id: id });
	db.query("DELETE FROM graph_enrich_queue WHERE node_id = $id").run({
		$id: id,
	});
	const result = db
		.query("DELETE FROM graph_nodes WHERE id = $id")
		.run({ $id: id }) as { changes?: number } | null;
	return Number(result?.changes ?? 0) > 0;
}

/** Remove selected or all adjacency from a node and return former neighbors. */
export function removeEdgesTouchingNode(
	nodeId: string,
	filter: {
		readonly origin?: GraphEdgeOrigin;
		readonly type?: GraphEdgeType;
	} = {},
): string[] {
	const clauses = ["(src = $id OR dst = $id)"];
	const params: Record<string, unknown> = { $id: nodeId };
	if (filter.origin) {
		clauses.push("origin = $origin");
		params.$origin = filter.origin;
	}
	if (filter.type) {
		clauses.push("type = $type");
		params.$type = filter.type;
	}
	const db = getDb();
	const rows = db
		.query(`SELECT src, dst FROM graph_edges WHERE ${clauses.join(" AND ")}`)
		.all(params) as Array<{ src: string; dst: string }>;
	db.query(`DELETE FROM graph_edges WHERE ${clauses.join(" AND ")}`).run(
		params,
	);
	return [
		...new Set(rows.map((row) => (row.src === nodeId ? row.dst : row.src))),
	];
}

export function deleteNodeByRef(ref: GraphNodeRef): boolean {
	const node = findNode(ref);
	return node ? deleteNode(node.id) : false;
}

// ── Enrichment queue ──────────────────────────────────────────────────

export function enqueueEnrichment(
	nodeId: string,
	steps: readonly GraphEnrichStep[],
	ts = nowIso(),
): void {
	if (steps.length === 0) return;
	const db = getDb();
	const existing = db
		.query("SELECT steps_json FROM graph_enrich_queue WHERE node_id = $id")
		.get({ $id: nodeId }) as { steps_json: string } | undefined;
	const merged = new Set<GraphEnrichStep>(steps);
	if (existing) {
		for (const s of JSON.parse(existing.steps_json) as GraphEnrichStep[]) {
			merged.add(s);
		}
	}
	db.query(
		`INSERT INTO graph_enrich_queue (node_id, steps_json, attempts, enqueued_at, next_attempt_at)
     VALUES ($id, $steps, 0, $ts, $ts)
     ON CONFLICT(node_id) DO UPDATE SET steps_json = $steps, attempts = 0, last_error = NULL, next_attempt_at = $ts`,
	).run({ $id: nodeId, $steps: JSON.stringify([...merged].sort()), $ts: ts });
}

export interface EnrichQueueEntry {
	readonly nodeId: string;
	readonly steps: readonly GraphEnrichStep[];
	readonly attempts: number;
}

export function dueEnrichment(
	limit: number,
	now = nowIso(),
): EnrichQueueEntry[] {
	const rows = getDb()
		.query(
			`SELECT node_id, steps_json, attempts FROM graph_enrich_queue
       WHERE next_attempt_at <= $now ORDER BY enqueued_at ASC LIMIT $limit`,
		)
		.all({ $now: now, $limit: Math.max(1, limit) }) as Array<{
		node_id: string;
		steps_json: string;
		attempts: number;
	}>;
	return rows.map((r) => ({
		nodeId: r.node_id,
		steps: JSON.parse(r.steps_json) as GraphEnrichStep[],
		attempts: r.attempts,
	}));
}

/** Remove finished steps; drop the entry when none remain. */
export function completeEnrichment(
	nodeId: string,
	done: readonly GraphEnrichStep[],
): void {
	const db = getDb();
	const row = db
		.query("SELECT steps_json FROM graph_enrich_queue WHERE node_id = $id")
		.get({ $id: nodeId }) as { steps_json: string } | undefined;
	if (!row) return;
	const remaining = (JSON.parse(row.steps_json) as GraphEnrichStep[]).filter(
		(s) => !done.includes(s),
	);
	if (remaining.length === 0) {
		db.query("DELETE FROM graph_enrich_queue WHERE node_id = $id").run({
			$id: nodeId,
		});
		return;
	}
	db.query(
		"UPDATE graph_enrich_queue SET steps_json = $steps WHERE node_id = $id",
	).run({ $id: nodeId, $steps: JSON.stringify(remaining) });
}

/** Keep an entry queued but skip it until `until` (no attempt is counted). */
export function deferEnrichment(nodeId: string, until: Date): void {
	getDb()
		.query(
			"UPDATE graph_enrich_queue SET next_attempt_at = $next WHERE node_id = $id",
		)
		.run({ $id: nodeId, $next: until.toISOString() });
}

const MAX_ENRICH_ATTEMPTS = 5;

/** Back off a failed entry (1, 2, 4, 8… minutes); give up after five attempts. */
export function failEnrichment(
	nodeId: string,
	error: string,
	now = new Date(),
): void {
	const db = getDb();
	const row = db
		.query("SELECT attempts FROM graph_enrich_queue WHERE node_id = $id")
		.get({ $id: nodeId }) as { attempts: number } | undefined;
	if (!row) return;
	const attempts = row.attempts + 1;
	if (attempts >= MAX_ENRICH_ATTEMPTS) {
		db.query("DELETE FROM graph_enrich_queue WHERE node_id = $id").run({
			$id: nodeId,
		});
		return;
	}
	const next = new Date(now.getTime() + 60_000 * 2 ** (attempts - 1));
	db.query(
		"UPDATE graph_enrich_queue SET attempts = $a, last_error = $e, next_attempt_at = $next WHERE node_id = $id",
	).run({
		$id: nodeId,
		$a: attempts,
		$e: error.slice(0, 500),
		$next: next.toISOString(),
	});
}

export function enrichQueueSize(): number {
	const row = getDb()
		.query("SELECT COUNT(*) AS count FROM graph_enrich_queue")
		.get() as { count: number } | undefined;
	return Number(row?.count ?? 0);
}

export function graphCounts(): { nodes: number; edges: number } {
	const db = getDb();
	const nodes = db.query("SELECT COUNT(*) AS c FROM graph_nodes").get() as {
		c: number;
	};
	const edges = db.query("SELECT COUNT(*) AS c FROM graph_edges").get() as {
		c: number;
	};
	return { nodes: Number(nodes.c), edges: Number(edges.c) };
}

/**
 * Remove edges derived from observations before deterministic graph rebuild.
 * Loop edges (`about` links to people/threads) are kept: rebuild only replays
 * observations and has no way to recreate them.
 */
export function clearRebuildableEdges(): number {
	const result = getDb()
		.query(
			`DELETE FROM graph_edges WHERE origin = 'deterministic' AND type NOT IN ('tracks', 'evidence_for')
       AND src NOT IN (SELECT id FROM graph_nodes WHERE type = 'loop')`,
		)
		.run() as { changes?: number } | null;
	return Number(result?.changes ?? 0);
}
