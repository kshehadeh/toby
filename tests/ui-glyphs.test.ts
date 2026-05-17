import { describe, expect, it } from "vitest";
import {
	PLAN_STATUS_GLYPHS,
	STATUS_GLYPHS,
	UI_GLYPHS,
} from "../src/ui/shared/glyphs";

describe("ui glyphs", () => {
	describe("UI_GLYPHS", () => {
		it("has cursor and spacer of correct lengths", () => {
			expect(UI_GLYPHS.cursor).toHaveLength(2);
			expect(UI_GLYPHS.spacer).toHaveLength(2);
		});
		it("has checkbox glyphs", () => {
			expect(UI_GLYPHS.checkboxOn).toBe("[x]");
			expect(UI_GLYPHS.checkboxOff).toBe("[ ]");
		});
	});

	describe("STATUS_GLYPHS", () => {
		it("maps every status key to a glyph and color", () => {
			for (const key of Object.keys(STATUS_GLYPHS) as Array<
				keyof typeof STATUS_GLYPHS
			>) {
				const entry = STATUS_GLYPHS[key];
				expect(entry.glyph).toBeTruthy();
				expect(entry.color).toBeTruthy();
			}
		});
	});

	describe("PLAN_STATUS_GLYPHS", () => {
		it("maps every plan phase status to a glyph and color", () => {
			for (const key of Object.keys(PLAN_STATUS_GLYPHS) as Array<
				keyof typeof PLAN_STATUS_GLYPHS
			>) {
				const entry = PLAN_STATUS_GLYPHS[key];
				expect(entry.glyph).toBeTruthy();
				expect(entry.color).toBeTruthy();
			}
		});
		it("completed uses the shared success glyph", () => {
			expect(PLAN_STATUS_GLYPHS.completed.glyph).toBe(UI_GLYPHS.success);
		});
		it("failed uses the shared failure glyph", () => {
			expect(PLAN_STATUS_GLYPHS.failed.glyph).toBe(UI_GLYPHS.failure);
		});
	});
});
