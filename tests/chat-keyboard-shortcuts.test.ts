import { describe, expect, it } from "vitest";
import { buildChatKeyboardShortcuts } from "../src/ui/chat/chat-keyboard-shortcuts";
import type { TerminalProfile } from "../src/ui/shared/terminal-profile";

const TEST_PROFILE: TerminalProfile = {
	name: "test",
	kittySupported: false,
	kittyProtocol: false,
	shiftEnter: "meta-return",
	metaBackspace: "escape-delete",
	wordDelete: "ctrl-w",
};

describe("buildChatKeyboardShortcuts", () => {
	it("includes terminal-specific newline and delete hints", () => {
		const shortcuts = buildChatKeyboardShortcuts(TEST_PROFILE);
		expect(shortcuts.some((item) => item.keys.includes("Alt+Enter"))).toBe(
			true,
		);
		expect(shortcuts.some((item) => item.keys === "Ctrl+W")).toBe(true);
	});

	it("documents the empty-input question-mark shortcut", () => {
		const shortcuts = buildChatKeyboardShortcuts(TEST_PROFILE);
		expect(
			shortcuts.some(
				(item) =>
					item.keys === "?" && item.description.includes("when input is empty"),
			),
		).toBe(true);
	});
});
