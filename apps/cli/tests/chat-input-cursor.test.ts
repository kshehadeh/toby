import { describe, expect, it } from "vitest";
import { reconcileCursorIndex } from "../src/ui/chat/input-cursor";

describe("chat input cursor reconciliation", () => {
	it("does not jump to end on ordinary input growth", () => {
		const next = reconcileCursorIndex({
			currentCursorIndex: 3,
			nextInputLength: 12,
			forceResetToEnd: false,
		});
		expect(next).toBe(3);
	});

	it("clamps cursor when input shrinks", () => {
		const next = reconcileCursorIndex({
			currentCursorIndex: 9,
			nextInputLength: 4,
			forceResetToEnd: false,
		});
		expect(next).toBe(4);
	});

	it("jumps to end when explicit reset is requested", () => {
		const next = reconcileCursorIndex({
			currentCursorIndex: 2,
			nextInputLength: 8,
			forceResetToEnd: true,
		});
		expect(next).toBe(8);
	});
});
