import type { SlashCommand } from "./types";

export const terminalSlashCommand: SlashCommand = {
	command: "/terminal",
	description: "Show terminal capability info",
	helpText: `Show terminal keyboard capabilities and active input mode.

  /terminal

Opens a scrollable viewer with the detected terminal name, Kitty keyboard
protocol status, and keymap profile for Shift+Enter and word-delete.`,
	run(runtime) {
		runtime.openTerminalViewer();
	},
};
