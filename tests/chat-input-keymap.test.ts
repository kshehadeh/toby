import { describe, expect, it } from "vitest";
import type { Key } from "ink";
import { resolveDeleteShortcutAction } from "../src/ui/chat/input-keymap";

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
		const action = resolveDeleteShortcutAction("", mkKey({ meta: true, backspace: true }));
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
