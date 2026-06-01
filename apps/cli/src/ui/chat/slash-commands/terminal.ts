import {
	detectTerminalProfile,
	inputModeLabel,
} from "../../shared/terminal-profile";
import type { SlashCommand } from "./types";

export const terminalSlashCommand: SlashCommand = {
	command: "/terminal",
	description: "Show terminal capability info",
	helpText: `Show terminal keyboard capabilities and active input mode.

  /terminal

Reports the detected terminal name, whether the Kitty keyboard protocol
is active, and the keymap profile for Shift+Enter and word-delete.`,
	run(runtime) {
		const profile = detectTerminalProfile();
		const lines = [
			`Terminal: ${profile.name}`,
			`Kitty supported: ${profile.kittySupported ? "yes" : "no"}`,
			`Kitty protocol: ${profile.kittyProtocol ? "active" : "not confirmed"}`,
			`Input mode: ${inputModeLabel(profile)}`,
			`Shift+Enter: ${profile.shiftEnter}`,
			`Meta+Backspace: ${profile.metaBackspace}`,
			`Word delete: ${profile.wordDelete}`,
			`TERM_PROGRAM: ${process.env.TERM_PROGRAM ?? "(unset)"}`,
			`TERM: ${process.env.TERM ?? "(unset)"}`,
		];
		for (const line of lines) {
			runtime.addMetaLine(line);
		}
	},
};
