import { AsyncLocalStorage } from "node:async_hooks";
import type { EmbeddingModel } from "ai";
import {
	createEmbeddingModelForPersona,
	embedTexts,
	resolveEmbedModelId,
} from "../ai/embeddings";
import { searchTopKScoredByCosine, vectorToBuffer } from "../ai/vector";
import { log } from "../logging/chat-log";
import { resolveDefaultPersona } from "../personas/index";
import * as store from "./memory-store";
import { formatMemoryEmbedText } from "./text";
import type { MemoryItem, MemoryVisibility } from "./types";

/** Cosine ≥ this (or identical content hash) is treated as the same fact. */
export const MEMORY_EMBED_NEAR_EXACT = 0.95;
/** Cosine ≥ this with the same type is a near-duplicate eligible to merge. */
export const MEMORY_EMBED_NEAR_DUP = 0.88;
/** Minimum cosine for a memory to count as a semantic search hit. */
export const MEMORY_EMBED_SEARCH_MIN_SCORE = 0.35;
export const MEMORY_EMBED_SEARCH_TOP_K = 25;
const BACKFILL_BATCH = 64;

export type MemoryEmbedder = {
	readonly model: EmbeddingModel;
	readonly modelId: string;
};

type EmbedTextsFn = (params: {
	readonly model: EmbeddingModel;
	readonly values: readonly string[];
}) => Promise<number[][]>;

type MemoryEmbedTestHooks = {
	readonly resolveEmbedder?: () => MemoryEmbedder | null;
	readonly embedTexts?: EmbedTextsFn;
};

let testHooksStore: AsyncLocalStorage<MemoryEmbedTestHooks> | null = null;

function testHooksAls(): AsyncLocalStorage<MemoryEmbedTestHooks> {
	if (!testHooksStore) {
		testHooksStore = new AsyncLocalStorage<MemoryEmbedTestHooks>();
	}
	return testHooksStore;
}

function currentTestHooks(): MemoryEmbedTestHooks | undefined {
	return testHooksAls().getStore();
}

/** Test-only override; scoped to the current async context so files stay isolated. */
export function runWithMemoryEmbedTestHooks<T>(
	hooks: MemoryEmbedTestHooks,
	fn: () => T,
): T {
	return testHooksAls().run(hooks, fn);
}

export function resolveMemoryEmbedder(): MemoryEmbedder | null {
	const hooked = currentTestHooks()?.resolveEmbedder;
	if (hooked) {
		return hooked();
	}
	const persona = resolveDefaultPersona();
	const model = createEmbeddingModelForPersona(persona);
	if (!model) {
		return null;
	}
	return { model, modelId: resolveEmbedModelId(persona) };
}

async function embedValues(
	embedder: MemoryEmbedder,
	values: readonly string[],
): Promise<number[][]> {
	const fn = currentTestHooks()?.embedTexts ?? embedTexts;
	return fn({ model: embedder.model, values });
}

export async function embedMemoryText(
	embedder: MemoryEmbedder,
	text: string,
): Promise<number[] | null> {
	try {
		const [vec] = await embedValues(embedder, [text]);
		return vec ?? null;
	} catch (error) {
		log("warn", "general", "memory_embed_failed", {
			reason: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

export async function storeMemoryEmbedding(
	item: Pick<MemoryItem, "id" | "value" | "subject">,
	embedder: MemoryEmbedder,
	vector?: readonly number[],
): Promise<void> {
	const vec =
		vector ?? (await embedMemoryText(embedder, formatMemoryEmbedText(item)));
	if (!vec) {
		return;
	}
	store.insertEmbedding(item.id, vectorToBuffer(vec), embedder.modelId);
}

export async function backfillMemoryEmbeddings(userId: string): Promise<void> {
	const embedder = resolveMemoryEmbedder();
	if (!embedder) {
		return;
	}
	const missing = store.listItemsNeedingEmbedding(userId, embedder.modelId);
	if (missing.length === 0) {
		return;
	}
	for (let i = 0; i < missing.length; i += BACKFILL_BATCH) {
		const batch = missing.slice(i, i + BACKFILL_BATCH);
		const texts = batch.map((item) => formatMemoryEmbedText(item));
		let vectors: number[][];
		try {
			vectors = await embedValues(embedder, texts);
		} catch (error) {
			log("warn", "general", "memory_embed_backfill_failed", {
				count: batch.length,
				reason: error instanceof Error ? error.message : String(error),
			});
			return;
		}
		for (let j = 0; j < batch.length; j++) {
			const item = batch[j];
			const vec = vectors[j];
			if (!item || !vec) continue;
			store.insertEmbedding(item.id, vectorToBuffer(vec), embedder.modelId);
		}
	}
}

export type MemoryNearDuplicate = {
	readonly item: MemoryItem;
	readonly score: number;
	readonly reason: "exact" | "near-exact" | "near-dup";
};

export async function findNearDuplicate(params: {
	readonly userId: string;
	readonly type: MemoryItem["type"];
	readonly value: string;
	readonly subject?: string;
	readonly excludeId?: string;
	readonly queryVector?: readonly number[];
	readonly embedder?: MemoryEmbedder | null;
}): Promise<MemoryNearDuplicate | null> {
	const embeddings = store
		.listEmbeddingsForUser(params.userId)
		.filter((row) => row.memoryId !== params.excludeId);

	const embedder = params.embedder ?? resolveMemoryEmbedder();
	let queryVector = params.queryVector;
	if (!queryVector && embedder) {
		queryVector =
			(await embedMemoryText(
				embedder,
				formatMemoryEmbedText({
					value: params.value,
					subject: params.subject,
				}),
			)) ?? undefined;
	}
	if (!queryVector || embeddings.length === 0) {
		return null;
	}

	const modelId = embedder?.modelId;
	const candidates = embeddings
		.filter((row) => (modelId ? row.model === modelId : true))
		.map((row) => ({ id: row.memoryId, vector: row.vector }));
	const scored = searchTopKScoredByCosine({
		query: queryVector,
		candidates,
		topK: 1,
		minScore: MEMORY_EMBED_NEAR_DUP,
	});
	const best = scored[0];
	if (!best) {
		return null;
	}
	const item = store.getItem(params.userId, best.id);
	if (!item) {
		return null;
	}
	if (best.score >= MEMORY_EMBED_NEAR_EXACT) {
		return { item, score: best.score, reason: "near-exact" };
	}
	if (item.type !== params.type) {
		return null;
	}
	return { item, score: best.score, reason: "near-dup" };
}

export async function semanticMemoryHits(params: {
	readonly userId: string;
	readonly query: string;
	readonly visibilities?: readonly MemoryVisibility[];
	readonly topK?: number;
	readonly minScore?: number;
}): Promise<ReadonlyMap<string, number>> {
	const scores = new Map<string, number>();
	const embedder = resolveMemoryEmbedder();
	if (!embedder) {
		return scores;
	}
	await backfillMemoryEmbeddings(params.userId);
	const queryVector = await embedMemoryText(embedder, params.query.trim());
	if (!queryVector) {
		return scores;
	}
	const allowed = params.visibilities ? new Set(params.visibilities) : null;
	const candidates = store
		.listEmbeddingsForUser(params.userId)
		.filter((row) => row.model === embedder.modelId)
		.filter((row) => (allowed ? allowed.has(row.visibility) : true))
		.map((row) => ({ id: row.memoryId, vector: row.vector }));
	const hits = searchTopKScoredByCosine({
		query: queryVector,
		candidates,
		topK: params.topK ?? MEMORY_EMBED_SEARCH_TOP_K,
		minScore: params.minScore ?? MEMORY_EMBED_SEARCH_MIN_SCORE,
	});
	for (const hit of hits) {
		scores.set(hit.id, hit.score);
	}
	return scores;
}
