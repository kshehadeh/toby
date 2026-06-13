import React, { useCallback, useMemo } from "react";
import { type TKeybindings, TextArea } from "react-ink-textarea";

/**
 * Renders the multi-line input via `react-ink-textarea`'s `<TextArea>`.
 *
 * Toby's `useMultilineInput` is the sole keyboard authority (so the
 * cross-terminal Shift+Enter handling is unchanged). The library runs in fully
 * controlled mode with no-op `onChange`/`onCursorChange`, which means its own
 * `useInput` handler cannot mutate the displayed buffer — every edit is driven
 * by the props we pass. `focus` is forwarded only so the library renders a real
 * blinking grapheme cursor; Enter is disabled so the library never submits.
 */
export interface MultilineTextAreaProps {
	readonly value: string;
	readonly cursorIndex: number;
	readonly rows?: number;
	readonly maxRows?: number;
	readonly focus?: boolean;
	readonly placeholder?: string;
	readonly tabSize?: number;
}

function normalizeLineEndings(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function indexToRowCol(value: string, index: number): [number, number] {
	const clamped = Math.max(0, Math.min(index, value.length));
	let line = 0;
	let lineStart = 0;
	for (let i = 0; i < clamped; i++) {
		if (value[i] === "\n") {
			line += 1;
			lineStart = i + 1;
		}
	}
	return [line, clamped - lineStart];
}

const DISABLE_SUBMIT: TKeybindings = { Enter: false };
const noop = () => {};

export function MultilineTextArea({
	value,
	cursorIndex,
	rows = 1,
	maxRows = 8,
	focus = true,
	placeholder = "",
	tabSize = 4,
}: MultilineTextAreaProps) {
	const normalized = useMemo(() => normalizeLineEndings(value), [value]);
	const cursorPosition = useMemo(
		() => indexToRowCol(normalized, cursorIndex),
		[normalized, cursorIndex],
	);
	const onChange = useCallback(noop, []);
	const onCursorChange = useCallback(noop, []);
	const onSubmit = useCallback(noop, []);

	return (
		<TextArea
			focus={focus}
			value={normalized}
			cursorPosition={cursorPosition}
			onChange={onChange}
			onCursorChange={onCursorChange}
			onSubmit={onSubmit}
			keybindings={DISABLE_SUBMIT}
			placeholder={placeholder}
			tabWidth={tabSize}
			initialLineCount={rows}
			viewportLines={maxRows}
		/>
	);
}
