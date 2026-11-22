import { edgesTouching, getNodes } from "./store";
import type {
	GraphEdge,
	GraphNeighbor,
	GraphNode,
	NeighborOptions,
} from "./types";

const MAX_DEPTH = 3;

/** Whether a node may be shown to the model (memory privacy rules). */
export function isNodeVisible(
	node: GraphNode,
	opts: { readonly includeUnconfirmed?: boolean; readonly now?: Date } = {},
): boolean {
	if (node.visibility === "private") return false;
	if (node.visibility === "requires_confirmation" && !opts.includeUnconfirmed)
		return false;
	const expiresAt = node.props.expiresAt;
	if (typeof expiresAt === "string" && expiresAt) {
		const at = Date.parse(expiresAt);
		if (Number.isFinite(at) && at <= (opts.now ?? new Date()).getTime())
			return false;
	}
	return true;
}

/**
 * Breadth-first walk over indexed adjacency (edges are followed in both
 * directions). Hidden nodes are neither returned nor walked through, so a
 * private memory never links two otherwise unrelated items.
 */
export function neighbors(
	startIds: string | readonly string[],
	opts: NeighborOptions = {},
): GraphNeighbor[] {
	const starts = getNodes(
		typeof startIds === "string" ? [startIds] : [...startIds],
	)
		.filter((node) => isNodeVisible(node, opts))
		.map((node) => node.id);
	const depthLimit = Math.max(1, Math.min(MAX_DEPTH, opts.depth ?? 1));
	const limit = Math.max(1, opts.limit ?? 100);
	const nodeTypes = opts.nodeTypes ? new Set(opts.nodeTypes) : null;
	const visited = new Set<string>(starts);
	const results: GraphNeighbor[] = [];
	let frontier = starts.map((id) => ({ id, score: 1 }));

	for (let depth = 1; depth <= depthLimit && frontier.length > 0; depth++) {
		const scoreById = new Map(frontier.map((f) => [f.id, f.score]));
		const edges = edgesTouching(
			frontier.map((f) => f.id),
			{
				edgeTypes: opts.edgeTypes,
				minWeight: opts.minWeight,
				minConfidence: opts.minConfidence,
				fanout: opts.fanout,
			},
		);
		const reached = new Map<string, { via: GraphEdge; score: number }>();
		for (const edge of edges) {
			const fromSrc = scoreById.has(edge.src);
			const from = fromSrc ? edge.src : edge.dst;
			const other = fromSrc ? edge.dst : edge.src;
			if (visited.has(other)) continue;
			const score = (scoreById.get(from) ?? 1) * edge.weight * edge.confidence;
			const prev = reached.get(other);
			if (!prev || score > prev.score) reached.set(other, { via: edge, score });
		}
		const nodes = getNodes([...reached.keys()]);
		const next: Array<{ id: string; score: number }> = [];
		for (const node of nodes) {
			visited.add(node.id);
			if (!isNodeVisible(node, opts)) continue;
			const hit = reached.get(node.id);
			if (!hit) continue;
			next.push({ id: node.id, score: hit.score });
			if (!nodeTypes || nodeTypes.has(node.type)) {
				results.push({ node, depth, via: hit.via, score: hit.score });
			}
		}
		frontier = next;
	}
	results.sort((a, b) => a.depth - b.depth || b.score - a.score);
	return results.slice(0, limit);
}

function nodeLine(node: GraphNode): string {
	const text =
		typeof node.props.text === "string" && node.props.text.trim()
			? `: ${node.props.text.trim().replace(/\s+/g, " ").slice(0, 240)}`
			: "";
	return `[${node.type}] ${node.label}${text}`;
}

/**
 * Compact text rendering of the neighborhood around `ids` for a prompt,
 * nearest and strongest first, cut at `maxChars`.
 */
export function contextFor(
	ids: readonly string[],
	opts: NeighborOptions & {
		readonly maxChars?: number;
		readonly nodeFilter?: (node: GraphNode) => boolean;
	} = {},
): { readonly text: string; readonly nodes: readonly GraphNeighbor[] } {
	const maxChars = opts.maxChars ?? 4000;
	const found = neighbors(ids, { depth: 2, limit: 60, ...opts });
	const lines: string[] = [];
	const kept: GraphNeighbor[] = [];
	let used = 0;
	for (const n of found) {
		if (opts.nodeFilter && !opts.nodeFilter(n.node)) continue;
		const line = `- ${nodeLine(n.node)} (via ${n.via.type}${n.depth > 1 ? `, ${n.depth} hops` : ""})`;
		if (used + line.length + 1 > maxChars) break;
		lines.push(line);
		kept.push(n);
		used += line.length + 1;
	}
	return { text: lines.join("\n"), nodes: kept };
}
