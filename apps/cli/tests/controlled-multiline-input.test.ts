import { describe, expect, it } from "vitest";
import {
	buildInputSegments,
	segmentsToPlainText,
} from "../src/ui/shared/controlled-multiline-input-segments";
import { UI_GLYPHS } from "../src/ui/shared/glyphs";

const identityFormat = (text: string) => text;

function build(
	overrides: Partial<Parameters<typeof buildInputSegments>[0]> = {},
) {
	return buildInputSegments({
		value: "Test",
		cursorIndex: 2,
		focus: true,
		showCursor: true,
		cursorVisible: true,
		cursorStyle: "block",
		cursorGlyph: UI_GLYPHS.inputCursor,
		placeholder: "",
		formatText: identityFormat,
		...overrides,
	});
}

describe("buildInputSegments", () => {
	describe("block cursor", () => {
		it("overlays the character at cursorIndex without inserting an extra column", () => {
			const { preCursor, postCursor } = build({ value: "Test", cursorIndex: 2 });
			const text = segmentsToPlainText([...preCursor, ...postCursor]);
			expect(text).toBe("Test");
			expect(preCursor.at(-1)).toEqual({ value: "s", type: "cursor" });
		});

		it("keeps the same width when the cursor blinks off", () => {
			const visible = build({ value: "Test", cursorIndex: 2, cursorVisible: true });
			const hidden = build({ value: "Test", cursorIndex: 2, cursorVisible: false });
			expect(segmentsToPlainText([...visible.preCursor, ...visible.postCursor])).toBe(
				"Test",
			);
			expect(segmentsToPlainText([...hidden.preCursor, ...hidden.postCursor])).toBe(
				"Test",
			);
			expect(hidden.preCursor.at(-1)).toEqual({ value: "s", type: "highlight" });
		});

		it("renders an inverse space at end-of-text", () => {
			const { preCursor, postCursor } = build({
				value: "Test",
				cursorIndex: 4,
				cursorVisible: true,
			});
			expect(segmentsToPlainText([...preCursor, ...postCursor])).toBe("Test ");
			expect(preCursor.at(-1)).toEqual({ value: " ", type: "cursor" });
		});

		it("renders an inverse space for empty focused input", () => {
			const { preCursor, postCursor } = build({
				value: "",
				cursorIndex: 0,
				cursorVisible: true,
			});
			expect(preCursor).toEqual([{ value: " ", type: "cursor" }]);
			expect(postCursor).toEqual([]);
		});

		it("masks the cursor character", () => {
			const maskedFormat = (text: string) => text.replace(/[^\n]/g, "•");
			const { preCursor, postCursor } = build({
				value: "abc",
				cursorIndex: 1,
				formatText: maskedFormat,
			});
			expect(segmentsToPlainText([...preCursor, ...postCursor])).toBe("•••");
			expect(preCursor.at(-1)).toEqual({ value: "•", type: "cursor" });
		});
	});

	describe("bar cursor", () => {
		it("inserts a pipe between text segments", () => {
			const { preCursor, postCursor } = build({
				value: "Test",
				cursorIndex: 2,
				cursorStyle: "bar",
			});
			expect(segmentsToPlainText([...preCursor, ...postCursor])).toBe("Te|st");
			expect(preCursor.at(-1)).toEqual({ value: "|", type: "cursor" });
		});

		it("uses a space placeholder when the bar cursor blinks off", () => {
			const { preCursor, postCursor } = build({
				value: "Test",
				cursorIndex: 2,
				cursorStyle: "bar",
				cursorVisible: false,
			});
			expect(segmentsToPlainText([...preCursor, ...postCursor])).toBe("Te st");
			expect(preCursor.at(-1)).toEqual({ value: " ", type: undefined });
		});
	});

	describe("unfocused and placeholder states", () => {
		it("renders the full value without a cursor when unfocused", () => {
			const { preCursor, postCursor } = build({ focus: false });
			expect(preCursor).toEqual([{ value: "Test" }]);
			expect(postCursor).toEqual([]);
		});

		it("shows placeholder text when empty and unfocused", () => {
			const { preCursor, postCursor } = build({
				value: "",
				focus: false,
				placeholder: "Type here…",
			});
			expect(preCursor).toEqual([
				{ value: "Type here…", type: "placeholder" },
			]);
			expect(postCursor).toEqual([]);
		});
	});
});
