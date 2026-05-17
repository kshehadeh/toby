import { describe, expect, it } from "vitest";
import { UI_HINTS } from "../src/ui/shared/keybindings";

describe("UI_HINTS", () => {
	it("includes navigator and fieldBrowse hints for sub-apps", () => {
		expect(UI_HINTS.navigator).toContain("q save");
		expect(UI_HINTS.fieldBrowse).toContain("Enter edit");
		expect(UI_HINTS.fieldBrowse).toContain("s save");
	});

	it("keeps list and detail hints stable", () => {
		expect(UI_HINTS.list).toContain("Enter select");
		expect(UI_HINTS.detail).toContain("b/Backspace back");
	});
});
