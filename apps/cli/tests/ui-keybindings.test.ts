import { describe, expect, it } from "bun:test";
import {
	type InputKey,
	isBackKey,
	isCancelKey,
	isConfirmKey,
	isNavigateDown,
	isNavigateUp,
	isQuitKey,
	isSaveKey,
	isSelectKey,
	isToggleKey,
} from "../src/ui/shared/keybindings";

const k = (overrides: Partial<InputKey> = {}): InputKey => ({
	backspace: false,
	delete: false,
	downArrow: false,
	escape: false,
	leftArrow: false,
	pageDown: false,
	pageUp: false,
	return: false,
	rightArrow: false,
	tab: false,
	upArrow: false,
	...overrides,
});

describe("ui keybindings", () => {
	describe("isNavigateUp", () => {
		it("matches upArrow", () => {
			expect(isNavigateUp("", k({ upArrow: true }))).toBe(true);
		});
		it("does not match k", () => {
			expect(isNavigateUp("k", k())).toBe(false);
		});
		it("does not match plain j", () => {
			expect(isNavigateUp("j", k())).toBe(false);
		});
	});

	describe("isNavigateDown", () => {
		it("matches downArrow", () => {
			expect(isNavigateDown("", k({ downArrow: true }))).toBe(true);
		});
		it("does not match j", () => {
			expect(isNavigateDown("j", k())).toBe(false);
		});
	});

	describe("isSelectKey", () => {
		it("matches return", () => {
			expect(isSelectKey("", k({ return: true }))).toBe(true);
		});
		it("does not match other keys", () => {
			expect(isSelectKey("a", k())).toBe(false);
		});
	});

	describe("isBackKey", () => {
		it("matches escape", () => {
			expect(isBackKey("", k({ escape: true }))).toBe(true);
		});
		it("does not match backspace", () => {
			expect(isBackKey("", k({ backspace: true }))).toBe(false);
		});
		it("does not match b", () => {
			expect(isBackKey("b", k())).toBe(false);
		});
	});

	describe("isCancelKey", () => {
		it("matches escape", () => {
			expect(isCancelKey("", k({ escape: true }))).toBe(true);
		});
		it("does not match n", () => {
			expect(isCancelKey("n", k())).toBe(false);
		});
	});

	describe("isConfirmKey", () => {
		it("matches return", () => {
			expect(isConfirmKey("", k({ return: true }))).toBe(true);
		});
		it("matches y", () => {
			expect(isConfirmKey("y", k())).toBe(true);
		});
	});

	describe("isQuitKey", () => {
		it("matches q", () => {
			expect(isQuitKey("q", k())).toBe(true);
		});
		it("does not match other letters", () => {
			expect(isQuitKey("a", k())).toBe(false);
		});
	});

	describe("isToggleKey", () => {
		it("matches space", () => {
			expect(isToggleKey(" ", k())).toBe(true);
		});
	});

	describe("isSaveKey", () => {
		it("matches s", () => {
			expect(isSaveKey("s", k())).toBe(true);
		});
	});
});
