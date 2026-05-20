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

export function isNavigateUp(input: string, key: InputKey): boolean {
	return key.upArrow || input === "k";
}

export function isNavigateDown(input: string, key: InputKey): boolean {
	return key.downArrow || input === "j";
}

export function isSelectKey(_input: string, key: InputKey): boolean {
	return key.return;
}

export function isBackKey(input: string, key: InputKey): boolean {
	return key.backspace || input === "b";
}

export function isCancelKey(input: string, key: InputKey): boolean {
	return key.escape || input === "n";
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
	confirm: "y/Enter confirm · n/Esc cancel",
	selectCancel: "↑↓ choose · Enter select · Esc cancel",
	selectFilter:
		"Type to filter · ↑↓ choose · Enter select · Backspace clear · Esc cancel",
	list: "↑↓ navigate · Enter select · q close",
	detail: "↑↓ navigate · Enter select · b/Backspace back · q close",
	navigator: "↑↓ navigate · Enter select · b/Backspace back · q save and close",
	fieldBrowse: "↑↓ navigate · Enter edit · s save · b/Backspace back · q close",
	back: "b/Backspace back",
} as const;
