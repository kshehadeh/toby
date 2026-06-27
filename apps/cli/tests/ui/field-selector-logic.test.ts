import { describe, expect, it } from "bun:test";
import type { SelectChoice } from "../../src/ui/shared/field-selector";
import {
	clampSelectionIndex,
	filterSelectChoices,
	initialSelectionIndex,
	scrollOffsetForSelection,
} from "../../src/ui/shared/field-selector-logic";

const choices: SelectChoice[] = [
	{ value: "openai/gpt-5-mini", label: "openai/gpt-5-mini" },
	{ value: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
	{ value: "moonshotai/kimi-k2.6", label: "moonshotai/kimi-k2.6" },
	{ value: "zai/glm-5.1", label: "zai/glm-5.1" },
];

describe("filterSelectChoices", () => {
	it("returns all choices when query is empty", () => {
		expect(filterSelectChoices(choices, "")).toEqual(choices);
		expect(filterSelectChoices(choices, "   ")).toEqual(choices);
	});

	it("matches value case-insensitively", () => {
		expect(filterSelectChoices(choices, "KIMI")).toEqual([
			{ value: "moonshotai/kimi-k2.6", label: "moonshotai/kimi-k2.6" },
		]);
		expect(filterSelectChoices(choices, "glm")).toEqual([
			{ value: "zai/glm-5.1", label: "zai/glm-5.1" },
		]);
	});

	it("matches label case-insensitively", () => {
		expect(filterSelectChoices(choices, "claude")).toEqual([
			{ value: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
		]);
	});

	it("returns empty array when nothing matches", () => {
		expect(filterSelectChoices(choices, "nonexistent")).toEqual([]);
	});
});

describe("clampSelectionIndex", () => {
	it("clamps to valid range", () => {
		expect(clampSelectionIndex(0, 5)).toBe(0);
		expect(clampSelectionIndex(3, 5)).toBe(3);
		expect(clampSelectionIndex(10, 5)).toBe(4);
		expect(clampSelectionIndex(-1, 5)).toBe(0);
	});

	it("returns 0 for empty list", () => {
		expect(clampSelectionIndex(5, 0)).toBe(0);
	});
});

describe("scrollOffsetForSelection", () => {
	it("returns 0 when total fits in viewport", () => {
		expect(scrollOffsetForSelection(3, 0, 10, 5)).toBe(0);
	});

	it("scrolls up when selection moves above viewport", () => {
		expect(scrollOffsetForSelection(2, 5, 5, 20)).toBe(2);
	});

	it("scrolls down when selection moves below viewport", () => {
		expect(scrollOffsetForSelection(9, 0, 5, 20)).toBe(5);
	});

	it("keeps offset when selection stays visible", () => {
		expect(scrollOffsetForSelection(3, 2, 5, 20)).toBe(2);
	});
});

describe("initialSelectionIndex", () => {
	it("selects current value when present", () => {
		expect(initialSelectionIndex(choices, "zai/glm-5.1")).toBe(3);
	});

	it("defaults to 0 when current value is missing", () => {
		expect(initialSelectionIndex(choices, "missing/model")).toBe(0);
		expect(initialSelectionIndex(choices, undefined)).toBe(0);
	});
});
