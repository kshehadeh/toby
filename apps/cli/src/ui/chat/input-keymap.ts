import type { Key } from "ink";

export type DeleteShortcutAction =
	| "none"
	| "delete-char"
	| "delete-word-backward";

export type WordNavigationAction =
	| "none"
	| "word-backward"
	| "word-forward"
	| "line-start"
	| "line-end";

export function resolveDeleteShortcutAction(
	typedInput: string,
	key: Key,
): DeleteShortcutAction {
	if (key.ctrl && typedInput === "u") {
		// Some terminals map Cmd+Backspace to Ctrl+U. We normalize to a
		// single-character delete to match the chat input behavior expectation.
		return "delete-char";
	}

	if (
		(key.meta && key.backspace) ||
		(key.meta && key.delete && !key.backspace)
	) {
		return "delete-word-backward";
	}

	if (key.backspace || key.delete) {
		return "delete-char";
	}

	return "none";
}

/**
 * Resolve word-navigation intent from a key event.
 *
 * Two encoding patterns are recognised:
 * 1. Kitty protocol / CSI-modified sequences (e.g. \x1b[1;3D):
 *    Ink sets `key.meta = true` alongside `key.leftArrow` / `key.rightArrow`.
 * 2. ESC+letter sequences (e.g. \x1bb / \x1bf) sent by most macOS terminals
 *    when "Option as +Esc" is active: Ink sets `key.meta = true` and passes
 *    the trailing letter in `typedInput` ("b" for backward, "f" for forward),
 *    but does NOT set the arrow-key booleans.
 *
 * Shift+Meta+Left/Right moves to the start/end of the entire input.
 * CSI terminals send \x1b[1;4D (Shift+Meta) — Ink reports both modifiers.
 * ESC+letter terminals send \x1bB / \x1bF (uppercase) — Ink sets
 * key.meta=true and typedInput is the uppercase letter.
 */
export function resolveWordNavigationAction(
	typedInput: string,
	key: Key,
): WordNavigationAction {
	if (key.shift && key.meta) {
		if (key.leftArrow) return "line-start";
		if (key.rightArrow) return "line-end";
		if (typedInput === "B") return "line-start";
		if (typedInput === "F") return "line-end";
	}
	if (key.meta && key.leftArrow) return "word-backward";
	if (key.meta && key.rightArrow) return "word-forward";
	if (key.meta && typedInput === "b") return "word-backward";
	if (key.meta && typedInput === "f") return "word-forward";
	return "none";
}

/**
 * Find the index of the start of the previous word.
 * Skips trailing whitespace, then skips non-whitespace characters going left.
 */
export function wordBackwardIndex(value: string, cursorIndex: number): number {
	let i = cursorIndex;
	while (i > 0 && /\s/.test(value[i - 1] ?? "")) i--;
	while (i > 0 && !/\s/.test(value[i - 1] ?? "")) i--;
	return i;
}

/**
 * Find the index of the start of the next word.
 * Skips leading non-whitespace, then skips whitespace going right.
 */
export function wordForwardIndex(value: string, cursorIndex: number): number {
	let i = cursorIndex;
	while (i < value.length && !/\s/.test(value[i] ?? "")) i++;
	while (i < value.length && /\s/.test(value[i] ?? "")) i++;
	return i;
}
