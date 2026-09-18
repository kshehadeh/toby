import { describe, expect, it } from "bun:test";
import {
	formatMemoryEmbedText,
	isMoreSpecificMemoryValue,
	memoryContentHash,
	normalizeMemoryText,
} from "@toby/core/memory/text";

describe("memory text helpers", () => {
	it("normalizes whitespace and case for hashing", () => {
		expect(normalizeMemoryText("  Prefers   Dark Mode ", " Theme ")).toBe(
			"theme\nprefers dark mode",
		);
		expect(memoryContentHash("Prefers Dark Mode", "theme")).toBe(
			memoryContentHash("prefers   dark mode", "Theme"),
		);
	});

	it("formats embed text as subject then value", () => {
		expect(formatMemoryEmbedText({ value: "Prefers dark mode" })).toBe(
			"Prefers dark mode",
		);
		expect(
			formatMemoryEmbedText({ value: "Prefers dark mode", subject: "theme" }),
		).toBe("theme\nPrefers dark mode");
	});

	it("detects a strictly more specific restatement", () => {
		expect(
			isMoreSpecificMemoryValue(
				"Lives in Baltimore, Maryland",
				"Lives in Baltimore",
			),
		).toBe(true);
		expect(
			isMoreSpecificMemoryValue(
				"Lives in Baltimore",
				"Lives in Baltimore, Maryland",
			),
		).toBe(false);
		expect(isMoreSpecificMemoryValue("Drinks tea", "Prefers coffee")).toBe(
			false,
		);
	});
});
