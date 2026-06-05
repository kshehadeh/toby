import { newlineHintText } from "../shared/multiline-text-edit";
import type { TerminalProfile } from "../shared/terminal-profile";

export type ChatKeyboardShortcut = {
	readonly keys: string;
	readonly description: string;
};

export function buildChatKeyboardShortcuts(
	profile: TerminalProfile,
): readonly ChatKeyboardShortcut[] {
	const newlineHint = newlineHintText(profile);
	const wordDeleteHint =
		profile.wordDelete === "native" || profile.wordDelete === "meta-delete"
			? "Option+Backspace"
			: "Ctrl+W";

	return [
		{ keys: "Enter", description: "Submit prompt" },
		{
			keys: "Enter",
			description: "Submit steering prompt (while turn is active)",
		},
		{ keys: newlineHint, description: "Insert newline in prompt" },
		{
			keys: "↑ / ↓",
			description:
				"Recent prompts when empty; move between lines while editing",
		},
		{ keys: "/", description: "Open slash command autocomplete" },
		{ keys: "Tab", description: "Complete nearest slash command" },
		{ keys: "Shift+Tab", description: "Cycle personas" },
		{
			keys: "?",
			description: "Show help (when input is empty)",
		},
		{ keys: "← / →", description: "Move cursor within the prompt" },
		{
			keys: "Option+← / Option+→",
			description: "Move cursor by word (macOS terminals)",
		},
		{
			keys: "Shift+Option+← / Shift+Option+→",
			description: "Jump to start or end of prompt",
		},
		{ keys: "Backspace", description: "Delete character before cursor" },
		{ keys: wordDeleteHint, description: "Delete previous word" },
		{ keys: "Esc", description: "Cancel an in-flight turn" },
		{ keys: "Ctrl+C", description: "Quit chat" },
	];
}
