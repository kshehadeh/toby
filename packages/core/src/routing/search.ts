export type ScoredEntity = {
	readonly id: string;
	readonly score: number;
};

/**
 * Cosine similarity between two equal-length vectors (assumes non-zero norms).
 */
export function cosineSimilarity(
	a: readonly number[],
	b: readonly number[],
): number {
	if (a.length !== b.length || a.length === 0) {
		return 0;
	}
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		const av = a[i] ?? 0;
		const bv = b[i] ?? 0;
		dot += av * bv;
		normA += av * av;
		normB += bv * bv;
	}
	if (normA === 0 || normB === 0) {
		return 0;
	}
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Rank entities by cosine similarity to a query vector; return up to topK ids
 * meeting minScore (in descending score order).
 */
export function searchTopKByCosine(params: {
	readonly query: readonly number[];
	readonly candidates: ReadonlyArray<{
		readonly id: string;
		readonly vector: readonly number[];
	}>;
	readonly topK: number;
	readonly minScore: number;
}): string[] {
	const scored: ScoredEntity[] = [];
	for (const c of params.candidates) {
		const score = cosineSimilarity(params.query, c.vector);
		if (score >= params.minScore) {
			scored.push({ id: c.id, score });
		}
	}
	scored.sort((x, y) => y.score - x.score);
	return scored.slice(0, params.topK).map((s) => s.id);
}

export function vectorToBuffer(vec: readonly number[]): Buffer {
	const f32 = new Float32Array(vec.length);
	for (let i = 0; i < vec.length; i++) {
		f32[i] = vec[i] ?? 0;
	}
	return Buffer.from(f32.buffer);
}

export function bufferToVector(blob: Buffer): number[] {
	const f32 = new Float32Array(
		blob.buffer,
		blob.byteOffset,
		blob.byteLength / Float32Array.BYTES_PER_ELEMENT,
	);
	return Array.from(f32);
}
