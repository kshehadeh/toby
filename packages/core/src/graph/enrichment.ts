import { z } from "zod";
import { embedTexts } from "../ai/embeddings";
import {
	bufferToVector,
	searchTopKScoredByCosine,
	vectorToBuffer,
} from "../ai/vector";
import { readConfig } from "../config/index";
import {
	type MemoryEmbedder,
	resolveMemoryEmbedder,
} from "../memory/embeddings";
import { getDb, insertEmbedding } from "../memory/memory-store";
import { formatMemoryEmbedText } from "../memory/text";
import { emailPersonKey, entityNameKey } from "./keys";
import { isNodeVisible } from "./query";
import {
	completeEnrichment,
	deferEnrichment,
	dueEnrichment,
	failEnrichment,
	getNode,
	removeEdgesTouchingNode,
	upsertEdgeByIds,
	upsertNode,
} from "./store";
import type { GraphNode, GraphNodeType } from "./types";

const DEFAULT_SEMANTIC_THRESHOLD = 0.8;
const DEFAULT_EXTRACTION_BUDGET = 300;
const MAX_EXTRACTION_BATCH = 8;
const LOOKBACK_DAYS = 45;

const entitySchema = z.object({
	type: z.enum(["person", "org", "project", "topic"]),
	name: z.string().trim().min(1).max(200),
	identifiers: z.array(z.string().trim().min(1).max(320)).max(20).optional(),
	confidence: z.number().min(0).max(1),
});
const extractionSchema = z.object({
	entities: z.array(entitySchema).max(100),
	links: z
		.array(
			z.object({
				nodeId: z.string().min(1),
				entity: entitySchema,
				edgeType: z.enum(["mentions", "about", "works_at", "alias_of"]),
			}),
		)
		.max(200),
});

export type ExtractedEntity = z.infer<typeof entitySchema>;
export type GraphExtraction = z.infer<typeof extractionSchema>;
export type GraphExtract = (nodes: readonly GraphNode[]) => Promise<unknown>;
export type GraphEmbed = (node: GraphNode) => Promise<{
	readonly vector: readonly number[];
	readonly model: string;
} | null>;

export interface GraphEnrichmentStats {
	readonly processed: number;
	readonly embedded: number;
	readonly semanticEdges: number;
	readonly extracted: number;
	readonly skipped: number;
	readonly errors: number;
}

type EmbeddingRow = {
	node_id: string;
	embedding_blob: Buffer | Uint8Array;
	model: string;
};

function safeVisibility(node: GraphNode): boolean {
	return isNodeVisible(node);
}

function nodeText(node: GraphNode): string {
	const text = typeof node.props.text === "string" ? node.props.text : "";
	return `${node.label}\n${text}`.trim().slice(0, 3000);
}

function queryCandidates(
	model: string,
	nodeId: string,
	cutoff: string,
): Array<{
	id: string;
	vector: number[];
}> {
	const db = getDb();
	const graphRows = db
		.query(
			`SELECT e.node_id, e.embedding_blob, e.model
       FROM graph_embeddings e JOIN graph_nodes n ON n.id = e.node_id
       WHERE e.model = $model AND e.node_id != $node
         AND n.type = 'observation' AND n.visibility = 'usable_by_ai'
         AND COALESCE(json_extract(n.props_json, '$.occurredAt'), n.updated_at) >= $cutoff`,
		)
		.all({ $model: model, $node: nodeId, $cutoff: cutoff }) as EmbeddingRow[];
	const memoryRows = db
		.query(
			`SELECT n.id AS node_id, e.embedding_blob, e.model
       FROM graph_nodes n JOIN memory_embeddings e ON e.memory_id = n.ref_id
       WHERE n.type = 'memory' AND n.ref_table = 'memory_items'
         AND n.id != $node AND n.visibility = 'usable_by_ai' AND e.model = $model`,
		)
		.all({ $model: model, $node: nodeId }) as EmbeddingRow[];
	return [...graphRows, ...memoryRows].map((row) => ({
		id: row.node_id,
		vector: bufferToVector(
			Buffer.isBuffer(row.embedding_blob)
				? row.embedding_blob
				: Buffer.from(row.embedding_blob),
		),
	}));
}

function saveNodeEmbedding(
	node: GraphNode,
	vector: readonly number[],
	model: string,
): void {
	if (node.type === "memory" && node.ref?.table === "memory_items") {
		insertEmbedding(node.ref.id, vectorToBuffer(vector), model);
		return;
	}
	getDb()
		.query(
			`INSERT OR REPLACE INTO graph_embeddings(node_id, embedding_blob, model, created_at)
       VALUES ($id, $blob, $model, $at)`,
		)
		.run({
			$id: node.id,
			$blob: vectorToBuffer(vector),
			$model: model,
			$at: new Date().toISOString(),
		});
}

async function defaultEmbed(node: GraphNode): Promise<{
	readonly vector: readonly number[];
	readonly model: string;
} | null> {
	const embedder: MemoryEmbedder | null = resolveMemoryEmbedder();
	if (!embedder) return null;
	let text = nodeText(node);
	if (node.type === "memory" && node.ref?.table === "memory_items") {
		const row = getDb()
			.query("SELECT subject, value FROM memory_items WHERE id = $id")
			.get({ $id: node.ref.id }) as
			| { subject: string | null; value: string }
			| undefined;
		if (row)
			text = formatMemoryEmbedText({
				subject: row.subject ?? undefined,
				value: row.value,
			});
	}
	const [vector] = await embedTexts({ model: embedder.model, values: [text] });
	return vector ? { vector, model: embedder.modelId } : null;
}

export function semanticMatches(params: {
	readonly nodeId: string;
	readonly vector: readonly number[];
	readonly candidates: ReadonlyArray<{
		readonly id: string;
		readonly vector: readonly number[];
	}>;
	readonly threshold?: number;
}): Array<{ readonly id: string; readonly score: number }> {
	return searchTopKScoredByCosine({
		query: params.vector,
		candidates: params.candidates.filter(
			(candidate) => candidate.id !== params.nodeId,
		),
		topK: 5,
		minScore: params.threshold ?? DEFAULT_SEMANTIC_THRESHOLD,
	});
}

function claimExtractionBudget(count: number, max: number, now: Date): number {
	const day = now.toISOString().slice(0, 10);
	const key = `extractions:${day}`;
	const db = getDb();
	return db.transaction(() => {
		const current = db
			.query("SELECT value FROM graph_meta WHERE key = $key")
			.get({ $key: key }) as { value: string } | undefined;
		const used = Number(current?.value ?? 0);
		const allowed = Math.max(0, Math.min(count, max - used));
		if (allowed > 0) {
			db.query(
				`INSERT INTO graph_meta(key, value) VALUES($key, $value)
         ON CONFLICT(key) DO UPDATE SET value = $value`,
			).run({ $key: key, $value: String(used + allowed) });
		}
		return allowed;
	})();
}

/** Start of the next UTC day, when the per-day extraction budget resets. */
function nextBudgetDay(now: Date): Date {
	return new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
	);
}

function entityNode(entity: ExtractedEntity) {
	const identifier = entity.identifiers?.find((value) => value.includes("@"));
	const key =
		entity.type === "person" && identifier
			? emailPersonKey(identifier)
			: entityNameKey(entity.name);
	return {
		type: entity.type as GraphNodeType,
		key,
		label: entity.name,
		props: {
			...(entity.identifiers?.length
				? { identifiers: entity.identifiers }
				: {}),
		},
	};
}

function applyExtraction(
	nodes: readonly GraphNode[],
	unknownResult: unknown,
): number {
	const parsed = extractionSchema.safeParse(unknownResult);
	if (!parsed.success)
		throw new Error("Graph extraction response failed validation");
	const allowedIds = new Set(nodes.map((node) => node.id));
	let created = 0;
	for (const entity of parsed.data.entities) {
		if (entity.confidence < 0.7) continue;
		upsertNode(entityNode(entity));
		created++;
	}
	for (const link of parsed.data.links) {
		if (!allowedIds.has(link.nodeId) || link.entity.confidence < 0.7) continue;
		const source = getNode(link.nodeId);
		if (!source || !safeVisibility(source)) continue;
		const entityInput = entityNode(link.entity);
		const entityId = upsertNode(entityInput);
		upsertEdgeByIds(link.nodeId, entityId, {
			type: link.edgeType,
			origin: "extracted",
			confidence: link.entity.confidence,
			weight: link.entity.confidence,
			provenanceNodeId: link.nodeId,
		});
		created++;
		if (link.entity.type === "person") {
			for (const identifier of link.entity.identifiers ?? []) {
				const email = identifier.includes("@") ? identifier : null;
				if (!email) continue;
				const stable = upsertNode({
					type: "person",
					key: emailPersonKey(email),
					label: link.entity.name,
					props: { email: email.trim().toLowerCase() },
				});
				if (stable !== entityId)
					upsertEdgeByIds(entityId, stable, {
						type: "alias_of",
						origin: "extracted",
						confidence: link.entity.confidence,
						weight: link.entity.confidence,
						provenanceNodeId: link.nodeId,
					});
			}
		}
	}
	return created;
}

/**
 * Drain queued graph enrichment. Embeddings use the same configured model as
 * memory; extraction is supplied by the follow-up evaluator to avoid a graph
 * dependency on the detector.
 */
export async function runGraphEnrichment(
	params: {
		readonly now?: Date;
		readonly limit?: number;
		readonly extract?: GraphExtract;
		readonly embed?: GraphEmbed;
	} = {},
): Promise<GraphEnrichmentStats> {
	const now = params.now ?? new Date();
	const queue = dueEnrichment(params.limit ?? 100, now.toISOString());
	const stats = {
		processed: 0,
		embedded: 0,
		semanticEdges: 0,
		extracted: 0,
		skipped: 0,
		errors: 0,
	};
	const extractionQueue: Array<{ node: GraphNode; steps: readonly string[] }> =
		[];
	const cutoff = new Date(
		now.getTime() - LOOKBACK_DAYS * 86_400_000,
	).toISOString();
	const threshold = Math.max(
		0,
		Math.min(
			1,
			readConfig().graph?.semanticThreshold ?? DEFAULT_SEMANTIC_THRESHOLD,
		),
	);

	for (const entry of queue) {
		const node = getNode(entry.nodeId);
		if (!node) {
			completeEnrichment(entry.nodeId, entry.steps);
			stats.skipped++;
			continue;
		}
		if (!safeVisibility(node)) {
			completeEnrichment(entry.nodeId, entry.steps);
			stats.skipped++;
			continue;
		}
		if (entry.steps.includes("embed")) {
			try {
				const embedding = await (params.embed ?? defaultEmbed)(node);
				if (!embedding) {
					completeEnrichment(entry.nodeId, ["embed"]);
					stats.skipped++;
				} else {
					saveNodeEmbedding(node, embedding.vector, embedding.model);
					removeEdgesTouchingNode(node.id, {
						origin: "semantic",
						type: "related_to",
					});
					const matches = semanticMatches({
						nodeId: node.id,
						vector: embedding.vector,
						candidates: queryCandidates(embedding.model, node.id, cutoff),
						threshold,
					});
					for (const match of matches) {
						upsertEdgeByIds(node.id, match.id, {
							type: "related_to",
							weight: match.score,
							confidence: match.score,
							origin: "semantic",
						});
					}
					stats.semanticEdges += matches.length;
					completeEnrichment(entry.nodeId, ["embed"]);
					stats.embedded++;
				}
			} catch (error) {
				failEnrichment(
					entry.nodeId,
					error instanceof Error ? error.message : String(error),
					now,
				);
				stats.errors++;
			}
		}
		if (entry.steps.includes("extract"))
			extractionQueue.push({ node, steps: entry.steps });
		stats.processed++;
	}

	if (!params.extract) return stats;
	const configuredBudget = readConfig().graph?.maxExtractionsPerDay;
	const maxBudget =
		Number.isFinite(configuredBudget) && configuredBudget !== undefined
			? Math.max(0, Math.floor(configuredBudget))
			: DEFAULT_EXTRACTION_BUDGET;
	for (let i = 0; i < extractionQueue.length; i += MAX_EXTRACTION_BATCH) {
		const batch = extractionQueue.slice(i, i + MAX_EXTRACTION_BATCH);
		const allowed = claimExtractionBudget(batch.length, maxBudget, now);
		// Over today's budget: keep the extract step queued for tomorrow's budget.
		for (const item of batch.slice(allowed)) {
			deferEnrichment(item.node.id, nextBudgetDay(now));
		}
		if (allowed === 0) continue;
		const allowedBatch = batch.slice(0, allowed);
		try {
			const output = await params.extract(
				allowedBatch.map((item) => item.node),
			);
			stats.extracted += applyExtraction(
				allowedBatch.map((item) => item.node),
				output,
			);
			for (const item of allowedBatch)
				completeEnrichment(item.node.id, ["extract"]);
		} catch (error) {
			for (const item of allowedBatch)
				failEnrichment(
					item.node.id,
					error instanceof Error ? error.message : String(error),
					now,
				);
			stats.errors += allowedBatch.length;
		}
	}
	return stats;
}
