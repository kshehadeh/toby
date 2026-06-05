import {
	type TerminalProfile,
	detectTerminalProfile,
} from "../shared/terminal-profile";
import { buildChatKeyboardShortcuts } from "./chat-keyboard-shortcuts";
import type { SlashCommand } from "./slash-commands";

export function buildHelpLines(
	commands: readonly SlashCommand[],
	profile: TerminalProfile = detectTerminalProfile(),
): readonly string[] {
	const lines: string[] = ["Slash commands:"];
	for (const command of commands) {
		lines.push(`${command.command}  ${command.helpText}`);
	}
	lines.push("");
	lines.push("Keyboard shortcuts:");
	for (const shortcut of buildChatKeyboardShortcuts(profile)) {
		lines.push(`${shortcut.keys}  ${shortcut.description}`);
	}
	lines.push("");
	lines.push(
		"Long replies use the full terminal height; scroll terminal scrollback for earlier lines.",
	);
	lines.push(
		"Type `/` for command autocomplete · Tab to complete · Shift+Tab to cycle personas.",
	);
	lines.push("Press ? with an empty prompt to open this help.");
	return lines;
}
