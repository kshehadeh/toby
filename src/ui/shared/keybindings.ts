import type { Key } from "ink";

export type InputKey = Pick<
	Key,
	| "backspace"
	| "delete"
	| "downArrow"
	| "escape"
	| "leftArrow"
	| "pageDown"
	| "pageUp"
	| "return"
	| "rightArrow"
	| "tab"
	| "upArrow"
>;

export function isNavigateUp(_input: string, key: InputKey): boolean {
	return key.upArrow;
}

export function isNavigateDown(_input: string, key: InputKey): boolean {
	return key.downArrow;
}

export function isSelectKey(_input: string, key: InputKey): boolean {
	return key.return;
}

export function isBackKey(_input: string, key: InputKey): boolean {
	return key.escape;
}

export function isCancelKey(_input: string, key: InputKey): boolean {
	return key.escape;
}

export function isConfirmKey(input: string, key: InputKey): boolean {
	return key.return || input === "y";
}

export function isQuitKey(input: string, _key: InputKey): boolean {
	return input === "q";
}

export function isToggleKey(input: string, _key: InputKey): boolean {
	return input === " ";
}

export function isSaveKey(input: string, _key: InputKey): boolean {
	return input === "s";
}

export const UI_HINTS = {
	confirm: "y/Enter confirm · Esc cancel",
	selectCancel: "↑↓ choose · Enter select · Esc cancel",
	selectFilter:
		"Type to filter · ↑↓ choose · Enter select · Backspace clear · Esc cancel",
	list: "↑↓ navigate · Enter select · Esc close",
	detail: "↑↓ navigate · Enter select · Esc back",
	fieldBrowse: "↑↓ navigate · Enter edit · s save · Esc back",
	back: "Esc back",
} as const;
