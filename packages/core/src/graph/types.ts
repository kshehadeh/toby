import type { MemorySensitivity, MemoryVisibility } from "../memory/types";

export const GRAPH_NODE_TYPES = [
	"person",
	"org",
	"project",
	"topic",
	"thread",
	"observation",
	"memory",
	"todo",
	"event",
	"loop",
] as const;
export type GraphNodeType = (typeof GRAPH_NODE_TYPES)[number];

export const GRAPH_EDGE_TYPES = [
	"sent",
	"received",
	"in_thread",
	"attends",
	"mentions",
	"about",
	"alias_of",
	"works_at",
	"related_to",
	"evidence_for",
	"tracks",
] as const;
export type GraphEdgeType = (typeof GRAPH_EDGE_TYPES)[number];

/** Edge types whose direction carries no meaning; stored with src < dst. */
export const SYMMETRIC_EDGE_TYPES: ReadonlySet<GraphEdgeType> = new Set([
	"related_to",
	"alias_of",
]);

export type GraphEdgeOrigin = "deterministic" | "semantic" | "extracted";

export interface GraphNodeRef {
	readonly type: GraphNodeType;
	readonly key: string;
}

export interface GraphNodeInput extends GraphNodeRef {
	/** Display label; when omitted on a new node the key is used. */
	readonly label?: string;
	/** Shallow-merged into existing props. */
	readonly props?: Record<string, unknown>;
	readonly sensitivity?: MemorySensitivity;
	readonly visibility?: MemoryVisibility;
	readonly ref?: { readonly table: string; readonly id: string };
}

export interface GraphNode {
	readonly id: string;
	readonly type: GraphNodeType;
	readonly key: string;
	readonly label: string;
	readonly props: Record<string, unknown>;
	readonly sensitivity: MemorySensitivity;
	readonly visibility: MemoryVisibility;
	readonly ref?: { readonly table: string; readonly id: string };
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface GraphEdgeInput {
	readonly src: GraphNodeInput;
	readonly dst: GraphNodeInput;
	readonly type: GraphEdgeType;
	/** 0–1 strength; repeated writes keep the max. Default 1. */
	readonly weight?: number;
	/** 0–1 belief that the edge is true. Default 1. */
	readonly confidence?: number;
	readonly origin?: GraphEdgeOrigin;
	readonly provenanceNodeId?: string;
	/** Optional explanation for evidence edges. */
	readonly reason?: string;
}

export interface GraphEdge {
	readonly id: string;
	readonly src: string;
	readonly dst: string;
	readonly type: GraphEdgeType;
	readonly weight: number;
	readonly confidence: number;
	readonly origin: GraphEdgeOrigin;
	readonly occurrences: number;
	readonly provenanceNodeId?: string;
	readonly reason?: string;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export type GraphEnrichStep = "embed" | "extract";

export interface GraphWriteInput {
	readonly nodes?: readonly GraphNodeInput[];
	readonly edges?: readonly GraphEdgeInput[];
	/** Enrichment queued for every node in `nodes` (not edge endpoints). */
	readonly enrich?: readonly GraphEnrichStep[];
}

export interface GraphWriteResult {
	/** Ids of `nodes`, in input order. */
	readonly nodeIds: readonly string[];
	readonly edgeIds: readonly string[];
}

export interface NeighborOptions {
	readonly depth?: number;
	readonly edgeTypes?: readonly GraphEdgeType[];
	readonly nodeTypes?: readonly GraphNodeType[];
	readonly minWeight?: number;
	readonly minConfidence?: number;
	/** Max results overall. */
	readonly limit?: number;
	/** Max edges followed out of any one node (keeps hubs cheap). */
	readonly fanout?: number;
	/** Include `requires_confirmation` nodes. `private` is never returned. */
	readonly includeUnconfirmed?: boolean;
	readonly now?: Date;
}

export interface GraphNeighbor {
	readonly node: GraphNode;
	readonly depth: number;
	/** Edge that first reached this node. */
	readonly via: GraphEdge;
	/** Product of edge weights along the path. */
	readonly score: number;
}
