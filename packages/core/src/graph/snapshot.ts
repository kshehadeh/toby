import { getDb } from "../memory/memory-store";
import { isNodeVisible } from "./query";
import {
	EDGE_COLUMNS,
	type EdgeRow,
	NODE_COLUMNS,
	type NodeRow,
	graphCounts,
	rowToEdge,
	rowToNode,
} from "./store";
import {
	GRAPH_NODE_TYPES,
	type GraphEdgeOrigin,
	type GraphEdgeType,
	type GraphNodeType,
} from "./types";

/** Node types shown by default; observations are folded into edges instead. */
export const SNAPSHOT_DEFAULT_TYPES: readonly GraphNodeType[] =
	GRAPH_NODE_TYPES.filter((type) => type !== "observation");

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const MAX_EDGES = 4000;
const CHUNK = 400;
/** Observations touching more shown nodes than this are not linked pairwise. */
const MAX_PAIRWISE_MEMBERS = 8;

export interface GraphSnapshotOptions {
	readonly types?: readonly GraphNodeType[];
	readonly limit?: number;
	/**
	 * When observations are hidden, link the shown nodes that share an
	 * observation (people on the same email, a person and the thread).
	 */
	readonly collapseObservations?: boolean;
	readonly now?: Date;
}

export interface GraphSnapshotNode {
	readonly id: string;
	readonly type: GraphNodeType;
	readonly label: string;
	readonly detail?: string;
	/** Edge count across the whole graph, not just this snapshot. */
	readonly degree: number;
	readonly updatedAt: string;
}

export interface GraphSnapshotEdge {
	readonly id: string;
	readonly src: string;
	readonly dst: string;
	readonly type: GraphEdgeType | "shared_activity";
	readonly weight: number;
	readonly confidence: number;
	readonly origin: GraphEdgeOrigin | "derived";
	readonly occurrences: number;
	readonly reason?: string;
}

export interface GraphSnapshot {
	readonly nodes: readonly GraphSnapshotNode[];
	readonly edges: readonly GraphSnapshotEdge[];
	readonly totals: { readonly nodes: number; readonly edges: number };
	/** More visible nodes of the requested types exist than were returned. */
	readonly truncated: boolean;
}

function placeholders(
	prefix: string,
	values: readonly string[],
	params: Record<string, unknown>,
): string {
	return values
		.map((value, i) => {
			params[`$${prefix}${i}`] = value;
			return `$${prefix}${i}`;
		})
		.join(",");
}

function chunks<T>(values: readonly T[]): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < values.length; i += CHUNK)
		out.push(values.slice(i, i + CHUNK));
	return out;
}

function detailFor(props: Record<string, unknown>): string | undefined {
	for (const key of ["text", "summary", "description", "email"]) {
		const value = props[key];
		if (typeof value === "string" && value.trim()) {
			return value.trim().replace(/\s+/g, " ").slice(0, 280);
		}
	}
	return undefined;
}

function pairKey(a: string, b: string): string {
	return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * The best-connected visible nodes of the requested types and the edges
 * among them, for the Connections view. Private and unconfirmed nodes are
 * never returned, matching what the model may see.
 */
export function graphSnapshot(opts: GraphSnapshotOptions = {}): GraphSnapshot {
	const db = getDb();
	const types = opts.types?.length ? opts.types : SNAPSHOT_DEFAULT_TYPES;
	const limit = Math.max(
		1,
		Math.min(MAX_LIMIT, Math.floor(opts.limit ?? DEFAULT_LIMIT)),
	);
	const typeParams: Record<string, unknown> = { $limit: limit + 1 };
	const typeList = placeholders("t", types, typeParams);
	const rows = db
		.query(
			`SELECT ${NODE_COLUMNS},
         (SELECT COUNT(*) FROM graph_edges WHERE src = n.id)
       + (SELECT COUNT(*) FROM graph_edges WHERE dst = n.id) AS degree
       FROM graph_nodes n
       WHERE visibility = 'usable_by_ai' AND type IN (${typeList})
       ORDER BY degree DESC, updated_at DESC
       LIMIT $limit`,
		)
		.all(typeParams) as Array<NodeRow & { degree: number }>;

	const truncated = rows.length > limit;
	const nodes: GraphSnapshotNode[] = [];
	for (const row of rows.slice(0, limit)) {
		const node = rowToNode(row);
		if (!isNodeVisible(node, { now: opts.now })) continue;
		const detail = detailFor(node.props);
		nodes.push({
			id: node.id,
			type: node.type,
			label: node.label,
			...(detail ? { detail } : {}),
			degree: Number(row.degree),
			updatedAt: node.updatedAt,
		});
	}
	const ids = new Set(nodes.map((n) => n.id));
	const idList = [...ids];

	const edges: GraphSnapshotEdge[] = [];
	const linked = new Set<string>();
	for (const chunk of chunks(idList)) {
		const params: Record<string, unknown> = {};
		const marks = placeholders("n", chunk, params);
		const edgeRows = db
			.query(
				`SELECT ${EDGE_COLUMNS} FROM graph_edges WHERE src IN (${marks}) ORDER BY weight DESC`,
			)
			.all(params) as EdgeRow[];
		for (const row of edgeRows) {
			if (!ids.has(row.dst) || edges.length >= MAX_EDGES) continue;
			const edge = rowToEdge(row);
			linked.add(pairKey(edge.src, edge.dst));
			edges.push({
				id: edge.id,
				src: edge.src,
				dst: edge.dst,
				type: edge.type,
				weight: edge.weight,
				confidence: edge.confidence,
				origin: edge.origin,
				occurrences: edge.occurrences,
				...(edge.reason ? { reason: edge.reason } : {}),
			});
		}
	}

	const collapse =
		(opts.collapseObservations ?? true) && !types.includes("observation");
	if (collapse && idList.length > 0) {
		edges.push(
			...sharedActivityEdges(
				idList,
				new Map(nodes.map((n) => [n.id, n.type])),
				linked,
				MAX_EDGES - edges.length,
			),
		);
	}

	return { nodes, edges, totals: graphCounts(), truncated };
}

/** Links between shown nodes that meet through a hidden observation. */
function sharedActivityEdges(
	ids: readonly string[],
	typeById: ReadonlyMap<string, GraphNodeType>,
	linked: ReadonlySet<string>,
	budget: number,
): GraphSnapshotEdge[] {
	if (budget <= 0) return [];
	const db = getDb();
	const members = new Map<string, Set<string>>();
	for (const chunk of chunks(ids)) {
		const params: Record<string, unknown> = {};
		const marks = placeholders("n", chunk, params);
		const rows = db
			.query(
				`SELECT e.src AS member, e.dst AS obs FROM graph_edges e
           JOIN graph_nodes o ON o.id = e.dst
           WHERE e.src IN (${marks}) AND o.type = 'observation' AND o.visibility = 'usable_by_ai'
         UNION ALL
         SELECT e.dst AS member, e.src AS obs FROM graph_edges e
           JOIN graph_nodes o ON o.id = e.src
           WHERE e.dst IN (${marks}) AND o.type = 'observation' AND o.visibility = 'usable_by_ai'`,
			)
			.all(params) as Array<{ member: string; obs: string }>;
		for (const row of rows) {
			const set = members.get(row.obs) ?? new Set<string>();
			set.add(row.member);
			members.set(row.obs, set);
		}
	}

	const counts = new Map<string, number>();
	const bump = (a: string, b: string) => {
		if (a === b) return;
		const key = pairKey(a, b);
		if (linked.has(key)) return;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	};
	for (const set of members.values()) {
		if (set.size < 2) continue;
		const list = [...set];
		const threads = list.filter((id) => typeById.get(id) === "thread");
		if (threads.length > 0) {
			// Star around the thread keeps large recipient lists readable.
			for (const thread of threads)
				for (const other of list) if (other !== thread) bump(thread, other);
		} else if (list.length <= MAX_PAIRWISE_MEMBERS) {
			for (let i = 0; i < list.length; i++)
				for (let j = i + 1; j < list.length; j++)
					bump(list[i] as string, list[j] as string);
		}
	}

	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, budget)
		.map(([key, count]) => {
			const [src, dst] = key.split("|") as [string, string];
			return {
				id: `shared:${key}`,
				src,
				dst,
				type: "shared_activity" as const,
				weight: Math.min(1, Math.log2(1 + count) / 4),
				confidence: 1,
				origin: "derived" as const,
				occurrences: count,
			};
		});
}
