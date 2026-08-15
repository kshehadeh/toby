import { describe, expect, it } from "bun:test";
import {
	MEMORY_INSTRUCTIONS_APPENDIX_START,
	MEMORY_INSTRUCTIONS_MAX_CHARS,
	formatMemoriesForInstructions,
	isUsableForPrompt,
} from "@toby/core/memory/prompt";
import type { MemoryItem } from "@toby/core/memory/types";

function item(
	overrides: Partial<MemoryItem> & Pick<MemoryItem, "value">,
): MemoryItem {
	return {
		id: overrides.id ?? "m1",
		userId: "default",
		type: overrides.type ?? "fact",
		subject: overrides.subject,
		value: overrides.value,
		confidence: overrides.confidence ?? 1,
		sensitivity: overrides.sensitivity ?? "normal",
		visibility: overrides.visibility ?? "usable_by_ai",
		sourceIds: [],
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00Z",
		expiresAt: overrides.expiresAt,
	};
}

describe("isUsableForPrompt", () => {
	it("allows usable_by_ai items", () => {
		expect(isUsableForPrompt(item({ value: "Lives in Baltimore" }))).toBe(true);
	});

	it("excludes requires_confirmation and private", () => {
		expect(
			isUsableForPrompt(
				item({ value: "secret", visibility: "requires_confirmation" }),
			),
		).toBe(false);
		expect(
			isUsableForPrompt(item({ value: "hidden", visibility: "private" })),
		).toBe(false);
	});

	it("excludes expired items", () => {
		expect(
			isUsableForPrompt(
				item({
					value: "old",
					expiresAt: "2020-01-01T00:00:00Z",
				}),
				Date.parse("2026-01-01T00:00:00Z"),
			),
		).toBe(false);
	});
});

describe("formatMemoriesForInstructions", () => {
	it("returns empty when there are no usable memories", () => {
		expect(formatMemoriesForInstructions([])).toBe("");
		expect(
			formatMemoriesForInstructions([
				item({ value: "hidden", visibility: "private" }),
			]),
		).toBe("");
	});

	it("includes usable memories and skips private ones", () => {
		const text = formatMemoriesForInstructions([
			item({ value: "Lives in Baltimore, Maryland" }),
			item({
				id: "m2",
				value: "SSN on file",
				visibility: "requires_confirmation",
			}),
			item({
				id: "m3",
				type: "fact",
				subject: "name",
				value: "My name is Karim Shehadeh",
			}),
		]);
		expect(text.startsWith(MEMORY_INSTRUCTIONS_APPENDIX_START)).toBe(true);
		expect(text).toContain("Lives in Baltimore, Maryland");
		expect(text).toContain("My name is Karim Shehadeh");
		expect(text).toContain("**fact** (name)");
		expect(text).not.toContain("SSN");
	});

	it("stays under the character budget and notes omitted items", () => {
		const items = Array.from({ length: 40 }, (_, i) =>
			item({
				id: `m${i}`,
				value: `Memory value ${i} ${"x".repeat(80)}`,
			}),
		);
		const text = formatMemoriesForInstructions(items, { maxChars: 400 });
		expect(text.length).toBeLessThanOrEqual(400);
		expect(text).toContain("more memories omitted due to size");
		expect(text).toContain("Memory value 0");
	});

	it("fits a small list under the default 20k budget", () => {
		const text = formatMemoriesForInstructions([
			item({ value: "Lives in Baltimore, Maryland" }),
			item({ id: "m2", value: "My name is Karim Shehadeh" }),
		]);
		expect(text.length).toBeLessThan(MEMORY_INSTRUCTIONS_MAX_CHARS);
		expect(text).toContain("Lives in Baltimore, Maryland");
	});
});
