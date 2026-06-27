import { describe, expect, it } from "bun:test";
import { UI_HINTS } from "../src/ui/shared/keybindings";

describe("UI_HINTS", () => {
	it("includes fieldBrowse hints for sub-apps", () => {
		expect(UI_HINTS.fieldBrowse).toContain("Enter edit");
		expect(UI_HINTS.fieldBrowse).toContain("s save");
		expect(UI_HINTS.fieldBrowse).toContain("Esc back");
	});

	it("keeps list and detail hints stable", () => {
		expect(UI_HINTS.list).toContain("Enter select");
		expect(UI_HINTS.detail).toContain("Esc back");
	});
});
