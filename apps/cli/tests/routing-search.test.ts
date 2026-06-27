import {
	cosineSimilarity,
	searchTopKByCosine,
} from "@toby/core/routing/search";
import { describe, expect, it } from "bun:test";

describe("cosineSimilarity", () => {
	it("returns 1 for identical vectors", () => {
		expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
	});

	it("returns 0 for orthogonal vectors", () => {
		expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 5);
	});
});

describe("searchTopKByCosine", () => {
	const candidates = [
		{ id: "gmailSearch", vector: [1, 0, 0] as const },
		{ id: "todoistListTasks", vector: [0, 1, 0] as const },
		{ id: "macosWifi", vector: [0, 0, 1] as const },
	];

	it("returns top matches above minScore in descending order", () => {
		const ids = searchTopKByCosine({
			query: [0.95, 0.05, 0],
			candidates,
			topK: 2,
			minScore: 0.04,
		});
		expect(ids).toEqual(["gmailSearch", "todoistListTasks"]);
	});

	it("respects topK cap", () => {
		const ids = searchTopKByCosine({
			query: [1, 1, 1],
			candidates,
			topK: 1,
			minScore: 0,
		});
		expect(ids).toHaveLength(1);
	});

	it("returns empty when nothing meets minScore", () => {
		const ids = searchTopKByCosine({
			query: [1, 0, 0],
			candidates,
			topK: 8,
			minScore: 0.99,
		});
		expect(ids).toEqual(["gmailSearch"]);
	});
});
