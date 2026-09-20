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
import { formatLibraryEmbedText, readExtractedText } from "./extract";
import * as store from "./library-store";
import type { LibraryItem } from "./types";

export const LIBRARY_EMBED_SEARCH_MIN_SCORE = 0.35;
export const LIBRARY_EMBED_SEARCH_TOP_K = 25;
const BACKFILL_BATCH = 64;

export type LibraryEmbedder = {
	readonly model: EmbeddingModel;
	readonly modelId: string;
};

type EmbedTextsFn = (params: {
	readonly model: EmbeddingModel;
	readonly values: readonly string[];
}) => Promise<number[][]>;

type LibraryEmbedTestHooks = {
	readonly resolveEmbedder?: () => LibraryEmbedder | null;
	readonly embedTexts?: EmbedTextsFn;
};

let testHooksStore: AsyncLocalStorage<LibraryEmbedTestHooks> | null = null;

function testHooksAls(): AsyncLocalStorage<LibraryEmbedTestHooks> {
	if (!testHooksStore) {
		testHooksStore = new AsyncLocalStorage<LibraryEmbedTestHooks>();
	}
	return testHooksStore;
}

export function runWithLibraryEmbedTestHooks<T>(
	hooks: LibraryEmbedTestHooks,
	fn: () => T,
): T {
	return testHooksAls().run(hooks, fn);
}

export function resolveLibraryEmbedder(): LibraryEmbedder | null {
	const hooked = testHooksAls().getStore()?.resolveEmbedder;
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
	embedder: LibraryEmbedder,
	values: readonly string[],
): Promise<number[][]> {
	const fn = testHooksAls().getStore()?.embedTexts ?? embedTexts;
	return fn({ model: embedder.model, values });
}

export async function embedLibraryText(
	embedder: LibraryEmbedder,
	text: string,
): Promise<number[] | null> {
	try {
		const [vec] = await embedValues(embedder, [text]);
		return vec ?? null;
	} catch (error) {
		log("warn", "general", "library_embed_failed", {
			reason: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

export async function storeLibraryEmbedding(
	item: LibraryItem,
	embedder: LibraryEmbedder,
): Promise<void> {
	const text = formatLibraryEmbedText({
		title: item.title,
		description: item.description,
		originalFilename: item.originalFilename,
		extractedText: readExtractedText(item.id),
	});
	const vec = await embedLibraryText(embedder, text);
	if (!vec) return;
	store.insertEmbedding(item.id, vectorToBuffer(vec), embedder.modelId);
}

export async function backfillLibraryEmbeddings(): Promise<void> {
	const embedder = resolveLibraryEmbedder();
	if (!embedder) return;
	const missing = store.listItemsNeedingEmbedding(embedder.modelId);
	if (missing.length === 0) return;
	for (let i = 0; i < missing.length; i += BACKFILL_BATCH) {
		const batch = missing.slice(i, i + BACKFILL_BATCH);
		const texts = batch.map((item) =>
			formatLibraryEmbedText({
				title: item.title,
				description: item.description,
				originalFilename: item.originalFilename,
				extractedText: readExtractedText(item.id),
			}),
		);
		let vectors: number[][];
		try {
			vectors = await embedValues(embedder, texts);
		} catch (error) {
			log("warn", "general", "library_embed_backfill_failed", {
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

export async function semanticLibraryHits(params: {
	readonly query: string;
	readonly topK?: number;
	readonly minScore?: number;
}): Promise<ReadonlyMap<string, number>> {
	const scores = new Map<string, number>();
	const embedder = resolveLibraryEmbedder();
	if (!embedder) return scores;
	await backfillLibraryEmbeddings();
	const queryVector = await embedLibraryText(embedder, params.query.trim());
	if (!queryVector) return scores;
	const candidates = store
		.listEmbeddings()
		.filter((row) => row.model === embedder.modelId)
		.map((row) => ({ id: row.itemId, vector: row.vector }));
	const hits = searchTopKScoredByCosine({
		query: queryVector,
		candidates,
		topK: params.topK ?? LIBRARY_EMBED_SEARCH_TOP_K,
		minScore: params.minScore ?? LIBRARY_EMBED_SEARCH_MIN_SCORE,
	});
	for (const hit of hits) {
		scores.set(hit.id, hit.score);
	}
	return scores;
}
