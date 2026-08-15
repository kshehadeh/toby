import { describe, expect, it } from "bun:test";
import {
	escapeLikePattern,
	extractKeywords,
	scoreMemoryMatch,
} from "@toby/core/memory/keywords";
import type { MemoryItem } from "@toby/core/memory/types";

function item(value: string, confidence = 0.9): MemoryItem {
	return {
		id: "m1",
		userId: "user1",
		type: "fact",
		value,
		confidence,
		sensitivity: "normal",
		visibility: "usable_by_ai",
		sourceIds: [],
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
	};
}

describe("memory keywords", () => {
	it("drops stopwords and short tokens", () => {
		expect(extractKeywords("where I live home address residence")).toEqual([
			"live",
			"home",
			"address",
			"residence",
		]);
	});

	it("escapes LIKE wildcards", () => {
		expect(escapeLikePattern("20% off_sale!")).toBe("20!% off!_sale!!");
	});

	it("scores a full-phrase hit above a single keyword", () => {
		const phrase = scoreMemoryMatch(
			item("Lives in Baltimore, Maryland"),
			"lives in baltimore",
			["lives", "baltimore"],
		);
		const single = scoreMemoryMatch(
			item("Baltimore is a great city", 0.95),
			"lives in baltimore",
			["lives", "baltimore"],
		);
		expect(phrase).toBeGreaterThan(single);
	});
});
