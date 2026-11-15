import { describe, expect, it } from "bun:test";
import { normalizeGeneratedTitle } from "@toby/core/listen/summarizer";

describe("normalizeGeneratedTitle", () => {
	it("keeps a plain title", () => {
		expect(normalizeGeneratedTitle("Pluto planet status request")).toBe(
			"Pluto planet status request",
		);
	});

	it("strips quotes, labels, markdown, and trailing punctuation", () => {
		expect(normalizeGeneratedTitle('"Pluto planet status."')).toBe(
			"Pluto planet status",
		);
		expect(normalizeGeneratedTitle("Title: Pluto planet status")).toBe(
			"Pluto planet status",
		);
		expect(normalizeGeneratedTitle("**Pluto planet status**")).toBe(
			"Pluto planet status",
		);
		expect(normalizeGeneratedTitle("# Pluto planet status")).toBe(
			"Pluto planet status",
		);
		expect(normalizeGeneratedTitle("“Pluto planet status”")).toBe(
			"Pluto planet status",
		);
	});

	it("drops reasoning blocks and uses the first non-empty line", () => {
		expect(
			normalizeGeneratedTitle(
				"<think>The summary is about Pluto.</think>\n\nPluto planet status\nExtra line",
			),
		).toBe("Pluto planet status");
	});

	it("returns empty for empty or reasoning-only output", () => {
		expect(normalizeGeneratedTitle("")).toBe("");
		expect(normalizeGeneratedTitle("   \n ")).toBe("");
		expect(normalizeGeneratedTitle("<think>still thinking")).toBe("");
	});
});
