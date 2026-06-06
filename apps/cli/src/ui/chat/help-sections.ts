import {
	type TerminalProfile,
	detectTerminalProfile,
} from "../shared/terminal-profile";
import { newlineHintText } from "../shared/multiline-text-edit";
import type { SlashCommand } from "./slash-commands";

export type HelpKeyRow = {
	readonly label: string;
	readonly keys: string;
};

export type HelpNumberedStep = {
	readonly title: string;
	readonly body?: string;
	readonly subItems?: readonly string[];
};

export type HelpSections = {
	readonly basics: readonly HelpKeyRow[];
	readonly shortcuts: readonly HelpKeyRow[];
	readonly navigation: readonly HelpKeyRow[];
	readonly commonCommands: readonly HelpKeyRow[];
	readonly gettingStarted: readonly HelpNumberedStep[];
	readonly tips: readonly string[];
};

const COMMON_COMMAND_NAMES = [
	"/help",
	"/config",
	"/persona",
	"/sessions",
	"/connect",
	"/listen",
	"/plan",
	"/skills",
] as const;

export function buildHelpSections(
	commands: readonly SlashCommand[],
	profile: TerminalProfile = detectTerminalProfile(),
): HelpSections {
	const newlineHint = newlineHintText(profile);
	const wordDeleteHint =
		profile.wordDelete === "native" || profile.wordDelete === "meta-delete"
			? "Option+Backspace"
			: "Ctrl+W";
	const commandByName = new Map(commands.map((command) => [command.command, command]));

	return {
		basics: [
			{ label: "Send", keys: "Enter" },
			{ label: "New line", keys: newlineHint },
			{
				label: "Submit steering prompt",
				keys: "Enter (while turn active)",
			},
			{ label: "Cancel turn", keys: "Esc" },
			{ label: "Quit chat", keys: "Ctrl+C" },
			{
				label: "History or line navigation",
				keys: "↑ / ↓",
			},
		],
		shortcuts: [
			{ label: "Commands menu", keys: "/" },
			{ label: "Complete command", keys: "Tab" },
			{ label: "Cycle personas", keys: "Shift+Tab" },
			{ label: "Show help", keys: "? (empty prompt)" },
			{ label: "Open configuration", keys: "/config" },
			{ label: "View session log", keys: "/log" },
		],
		navigation: [
			{ label: "Move cursor", keys: "← / →" },
			{
				label: "Move by word",
				keys: "Option+← / Option+→",
			},
			{
				label: "Jump to start/end",
				keys: "Shift+Option+← / →",
			},
			{ label: "Delete character", keys: "Backspace" },
			{ label: "Delete word", keys: wordDeleteHint },
		],
		commonCommands: COMMON_COMMAND_NAMES.flatMap((commandName) => {
			const command = commandByName.get(commandName);
			if (!command) {
				return [];
			}
			return [{ label: command.helpText, keys: command.command }];
		}),
		gettingStarted: [
			{
				title: "Ask a question",
				body: "Type what you need — Toby uses your connected integrations and session context.",
			},
			{
				title: "Configure integrations",
				body: "Run /config to connect Gmail, Todoist, calendars, and other tools.",
			},
			{
				title: "Switch personas",
				subItems: ["Shift+Tab cycles personas", "/persona opens the picker"],
			},
			{
				title: "Resume or start fresh",
				subItems: ["/sessions resumes a chat", "/new starts a blank session"],
			},
		],
		tips: [
			"Type / to open slash command autocomplete",
			"Tab completes the nearest matching command",
			"Press ? with an empty prompt to reopen this help",
			"Scroll terminal scrollback for long assistant replies",
		],
	};
}
