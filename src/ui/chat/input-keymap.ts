import type { Key } from "ink";

export type DeleteShortcutAction =
	| "none"
	| "delete-char"
	| "delete-word-backward";

export function resolveDeleteShortcutAction(
	typedInput: string,
	key: Key,
): DeleteShortcutAction {
	if (key.ctrl && typedInput === "u") {
		// Some terminals map Cmd+Backspace to Ctrl+U. We normalize to a
		// single-character delete to match the chat input behavior expectation.
		return "delete-char";
	}

	if ((key.meta && key.backspace) || (key.meta && key.delete && !key.backspace)) {
		return "delete-word-backward";
	}

	if (key.backspace || key.delete) {
		return "delete-char";
	}

	return "none";
}
