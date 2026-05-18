import { Box, Text } from "ink";
import { ControlledMultilineInput } from "ink-multiline-input";
import React from "react";
import { INPUT_BORDER } from "../chat/constants";
import type { TerminalProfile } from "./terminal-profile";
import {
	type UseMultilineInputOptions,
	useMultilineInput,
} from "./use-multiline-input";

export interface MultilineTextEditProps
	extends Omit<UseMultilineInputOptions, "active"> {
	/** Whether the control has focus (drives both useInput and visual state). */
	readonly focus: boolean;
	/** Width of the outer box in terminal columns. */
	readonly width: number;
	/** Placeholder text shown when the input is empty. */
	readonly placeholder?: string;
	/** Color for the prompt symbol (e.g. ">"). */
	readonly accentColor?: string;
	/** Border color for the input box. Defaults to INPUT_BORDER. */
	readonly borderColor?: string;
	/** Minimum visible rows for the input area. Default 1. */
	readonly rows?: number;
	/** Maximum visible rows for the input area. Default 8. */
	readonly maxRows?: number;
	/** Whether to show a static placeholder instead of the live input. */
	readonly showStaticPlaceholder?: boolean;
	/** Recent prompts for ↑/↓ recall when the input is empty. */
	readonly recentPrompts?: readonly string[];
}

export function MultilineTextEdit({
	focus,
	width,
	value,
	onChange,
	onSubmit,
	placeholder,
	accentColor = "yellow",
	borderColor = INPUT_BORDER,
	rows = 1,
	maxRows = 8,
	cursorResetToken,
	enterMode,
	onCancel,
	showStaticPlaceholder = false,
	recentPrompts,
}: MultilineTextEditProps) {
	const { cursorIndex, terminalProfile } = useMultilineInput({
		value,
		onChange,
		onSubmit,
		active: focus,
		cursorResetToken,
		enterMode,
		onCancel,
		recentPrompts,
	});

	const placeholderText = placeholder ?? "";
	const innerWidth = width - 2;

	return (
		<Box
			flexDirection="column"
			borderStyle="single"
			borderColor={borderColor}
			width={width}
		>
			<Box paddingX={1} paddingY={0} width={innerWidth} flexDirection="row">
				<Box flexShrink={0}>
					<Text color={accentColor} bold>
						{"> "}
					</Text>
				</Box>
				<Box flexGrow={1} flexDirection="column">
					{showStaticPlaceholder ? (
						<Text dimColor wrap="truncate-end">
							{placeholderText}
						</Text>
					) : (
						<ControlledMultilineInput
							value={value}
							cursorIndex={cursorIndex}
							rows={rows}
							maxRows={maxRows}
							focus={focus}
							placeholder={placeholderText}
						/>
					)}
				</Box>
			</Box>
		</Box>
	);
}

/**
 * Build a context-sensitive hint string for the input area footer,
 * based on the terminal's actual capabilities.
 */
export function newlineHintText(profile: TerminalProfile): string {
	if (profile.shiftEnter === "native") {
		return "Shift+Enter newline";
	}
	if (profile.shiftEnter === "meta-return") {
		return "Alt+Enter newline";
	}
	// "unsupported" or "escape-newline" — suggest Ctrl+Enter as a
	// portable alternative that works across most terminals.
	return "Ctrl+Enter newline";
}
