import type { Key } from "ink";
import { describe, expect, it } from "vitest";
import {
	resolveDeleteShortcutAction,
	resolveWordNavigationAction,
	wordBackwardIndex,
	wordForwardIndex,
} from "../src/ui/chat/input-keymap";

function mkKey(overrides: Partial<Key>): Key {
	return {
		ctrl: false,
		meta: false,
		shift: false,
		upArrow: false,
		downArrow: false,
		leftArrow: false,
		rightArrow: false,
		return: false,
		escape: false,
		backspace: false,
		delete: false,
		tab: false,
		...overrides,
	};
}

describe("chat input delete shortcut keymap", () => {
	it("maps Option+Delete (meta+backspace) to previous-word delete", () => {
		const action = resolveDeleteShortcutAction(
			"",
			mkKey({ meta: true, backspace: true }),
		);
		expect(action).toBe("delete-word-backward");
	});

	it("maps Ctrl+U fallback to single-character delete", () => {
		const action = resolveDeleteShortcutAction("u", mkKey({ ctrl: true }));
		expect(action).toBe("delete-char");
	});

	it("maps plain backspace to single-character delete", () => {
		const action = resolveDeleteShortcutAction("", mkKey({ backspace: true }));
		expect(action).toBe("delete-char");
	});
});

describe("word navigation keymap", () => {
	it("maps Meta+Left to word-backward", () => {
		const action = resolveWordNavigationAction(
			"",
			mkKey({ meta: true, leftArrow: true }),
		);
		expect(action).toBe("word-backward");
	});

	it("maps Meta+Right to word-forward", () => {
		const action = resolveWordNavigationAction(
			"",
			mkKey({ meta: true, rightArrow: true }),
		);
		expect(action).toBe("word-forward");
	});

	it("maps Meta+b (ESC+b from macOS Option+Left) to word-backward", () => {
		const action = resolveWordNavigationAction("b", mkKey({ meta: true }));
		expect(action).toBe("word-backward");
	});

	it("maps Meta+f (ESC+f from macOS Option+Right) to word-forward", () => {
		const action = resolveWordNavigationAction("f", mkKey({ meta: true }));
		expect(action).toBe("word-forward");
	});

	it("returns none for plain arrow keys", () => {
		expect(resolveWordNavigationAction("", mkKey({ leftArrow: true }))).toBe(
			"none",
		);
		expect(resolveWordNavigationAction("", mkKey({ rightArrow: true }))).toBe(
			"none",
		);
	});

	it("returns none for plain b/f without meta", () => {
		expect(resolveWordNavigationAction("b", mkKey({}))).toBe("none");
		expect(resolveWordNavigationAction("f", mkKey({}))).toBe("none");
	});
});

describe("line-boundary navigation keymap (Shift+Meta+Left/Right)", () => {
	it("maps Shift+Meta+Left (CSI) to line-start", () => {
		const action = resolveWordNavigationAction(
			"",
			mkKey({ shift: true, meta: true, leftArrow: true }),
		);
		expect(action).toBe("line-start");
	});

	it("maps Shift+Meta+Right (CSI) to line-end", () => {
		const action = resolveWordNavigationAction(
			"",
			mkKey({ shift: true, meta: true, rightArrow: true }),
		);
		expect(action).toBe("line-end");
	});

	it("maps Shift+Meta+B (ESC+B from macOS Shift+Option+Left) to line-start", () => {
		const action = resolveWordNavigationAction(
			"B",
			mkKey({ shift: true, meta: true }),
		);
		expect(action).toBe("line-start");
	});

	it("maps Shift+Meta+F (ESC+F from macOS Shift+Option+Right) to line-end", () => {
		const action = resolveWordNavigationAction(
			"F",
			mkKey({ shift: true, meta: true }),
		);
		expect(action).toBe("line-end");
	});

	it("Shift without meta does not trigger line-boundary", () => {
		expect(
			resolveWordNavigationAction("", mkKey({ shift: true, leftArrow: true })),
		).toBe("none");
		expect(
			resolveWordNavigationAction("", mkKey({ shift: true, rightArrow: true })),
		).toBe("none");
	});

	it("Shift+Meta+Left is line-start, not word-backward", () => {
		const action = resolveWordNavigationAction(
			"",
			mkKey({ shift: true, meta: true, leftArrow: true }),
		);
		expect(action).toBe("line-start");
		expect(action).not.toBe("word-backward");
	});
});

describe("wordBackwardIndex", () => {
	it("skips whitespace then non-whitespace going left", () => {
		expect(wordBackwardIndex("hello world", 11)).toBe(6);
	});

	it("stops at the beginning of the string", () => {
		expect(wordBackwardIndex("hello", 5)).toBe(0);
	});

	it("handles multiple spaces between words", () => {
		expect(wordBackwardIndex("hello   world", 12)).toBe(8);
	});

	it("handles cursor in middle of a word", () => {
		expect(wordBackwardIndex("hello world", 8)).toBe(6);
	});

	it("handles cursor at start of a word", () => {
		expect(wordBackwardIndex("hello world", 6)).toBe(0);
	});
});

describe("wordForwardIndex", () => {
	it("skips non-whitespace then whitespace going right", () => {
		expect(wordForwardIndex("hello world", 0)).toBe(6);
	});

	it("stops at the end of the string", () => {
		expect(wordForwardIndex("hello", 0)).toBe(5);
	});

	it("handles multiple spaces between words", () => {
		expect(wordForwardIndex("hello   world", 0)).toBe(8);
	});

	it("handles cursor in middle of a word", () => {
		expect(wordForwardIndex("hello world", 3)).toBe(6);
	});

	it("handles cursor at end of a word before space", () => {
		expect(wordForwardIndex("hello world", 5)).toBe(6);
	});
});
