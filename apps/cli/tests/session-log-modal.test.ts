import { describe, expect, it } from "vitest";
import {
	maxScrollModalOffset,
	scrollModalVisibleLineBudget,
} from "../src/ui/chat/components/scrollable-text-modal";
import { buildHelpSections } from "../src/ui/chat/help-sections";
import { buildTerminalInfoLines } from "../src/ui/chat/terminal-info-lines";
import { SLASH_COMMANDS } from "../src/ui/chat/slash-commands";

describe("scrollable text modal helpers", () => {
	it("computes scroll bounds from terminal height", () => {
		const budget = scrollModalVisibleLineBudget(24);
		expect(budget).toBeGreaterThanOrEqual(4);
		expect(maxScrollModalOffset(50, budget)).toBe(50 - budget);
	});

	it("returns zero max offset when all lines fit", () => {
		expect(maxScrollModalOffset(5, 10)).toBe(0);
	});
});

describe("buildHelpSections", () => {
	it("includes grouped help sections for the panel UI", () => {
		const sections = buildHelpSections(SLASH_COMMANDS, {
			name: "test",
			kittySupported: false,
			kittyProtocol: false,
			shiftEnter: "meta-return",
			metaBackspace: "escape-delete",
			wordDelete: "ctrl-w",
		});
		expect(sections.basics.some((row) => row.keys === "Enter")).toBe(true);
		expect(sections.shortcuts.some((row) => row.keys === "/")).toBe(true);
		expect(
			sections.commonCommands.some((row) => row.keys === "/help"),
		).toBe(true);
		expect(sections.gettingStarted.length).toBeGreaterThan(0);
		expect(
			sections.tips.some((tip) => tip.includes("empty prompt")),
		).toBe(true);
	});
});

describe("buildTerminalInfoLines", () => {
	it("includes core terminal profile fields", () => {
		const lines = buildTerminalInfoLines({
			name: "iTerm2",
			kittySupported: true,
			kittyProtocol: true,
			shiftEnter: "native",
			metaBackspace: "native",
			wordDelete: "native",
		});
		expect(lines.some((line) => line.startsWith("Terminal: iTerm2"))).toBe(
			true,
		);
		expect(lines.some((line) => line.includes("Kitty protocol: active"))).toBe(
			true,
		);
	});
});
