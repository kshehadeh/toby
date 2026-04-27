import type { LanguageModelUsage } from "ai";
import { Box, Text, useInput } from "ink";
import type { Key } from "ink";
import { ControlledMultilineInput } from "ink-multiline-input";
import React, { useEffect, useRef, useState } from "react";
import type { Persona } from "../../../config/index";
import { INPUT_BORDER } from "../constants";
import type { SlashCommand } from "../slash-commands";

function formatUsage(usage: LanguageModelUsage | null): string | null {
	if (!usage?.inputTokenDetails || !usage.outputTokens) {
		return null;
	}
	const inTokens = usage.inputTokens;
	const outTokens = usage.outputTokens;
	const total = usage.totalTokens;
	const cache = usage.inputTokenDetails.cacheReadTokens;

	const pieces = [
		inTokens !== undefined ? `in=${inTokens}` : null,
		outTokens !== undefined ? `out=${outTokens}` : null,
		total !== undefined ? `tot=${total}` : null,
		cache !== undefined ? `cache=${cache}` : null,
	].filter(Boolean);

	return pieces.length > 0 ? pieces.join(" ") : null;
}

type ChatInputDockProps = {
	readonly termCols: number;
	readonly input: string;
	readonly onInputChange: (value: string) => void;
	readonly onInputSubmit: (value: string) => void;
	readonly inputDisabled: boolean;
	readonly persona: Persona;
	readonly modelLabel: string;
	readonly scopeLabel: string;
	readonly dryRun: boolean;
	readonly lastUsage: LanguageModelUsage | null;
	readonly placeholder?: string | null;
	readonly slashSuggestions: readonly SlashCommand[];
	readonly selectedSlashCommand: SlashCommand | null;
};

export function ChatInputDock(props: ChatInputDockProps) {
	const {
		termCols,
		input,
		onInputChange,
		onInputSubmit,
		inputDisabled,
		persona,
		modelLabel,
		scopeLabel,
		dryRun,
		lastUsage,
		placeholder,
		slashSuggestions,
		selectedSlashCommand,
	} = props;

	const pendingBackslashRef = useRef(false);
	const [cursorIndex, setCursorIndex] = useState(input.length);

	useEffect(() => {
		setCursorIndex((prev) => Math.min(prev, input.length));
	}, [input.length]);

	const deleteWordBackward = () => {
		if (cursorIndex <= 0) {
			return;
		}
		let start = cursorIndex;
		while (start > 0 && /\s/.test(input[start - 1] ?? "")) {
			start--;
		}
		while (start > 0 && !/\s/.test(input[start - 1] ?? "")) {
			start--;
		}
		onInputChange(input.slice(0, start) + input.slice(cursorIndex));
		setCursorIndex(start);
	};

	const deleteToLineStart = () => {
		if (cursorIndex <= 0) {
			return;
		}
		const lineStart = input.lastIndexOf("\n", cursorIndex - 1) + 1;
		onInputChange(input.slice(0, lineStart) + input.slice(cursorIndex));
		setCursorIndex(lineStart);
	};

	const insertAtCursor = (text: string) => {
		const next = input.slice(0, cursorIndex) + text + input.slice(cursorIndex);
		onInputChange(next);
		setCursorIndex(cursorIndex + text.length);
	};

	const isActive = !inputDisabled;
	useInput(
		(rawInput, rawKey) => {
			if (!isActive) {
				return;
			}

			const processInput = (typedInput: string, key: Key) => {
				const shouldSubmit = key.return && !key.shift && !key.meta && !key.ctrl;
				const shouldNewline = key.return && (key.shift || key.meta || key.ctrl);

				if (shouldSubmit) {
					onInputSubmit(input);
					return;
				}

				if (shouldNewline) {
					insertAtCursor("\n");
					return;
				}

				if (
					key.tab ||
					(key.shift && key.tab) ||
					(key.ctrl && typedInput === "c")
				) {
					return;
				}

				if (key.upArrow) {
					const lines = input.split("\n");
					let currentLineIndex = 0;
					let currentPos = 0;
					let col = 0;
					for (let i = 0; i < lines.length; i++) {
						const line = lines[i];
						const lineLen = line?.length ?? 0;
						const lineEnd = currentPos + lineLen;
						if (cursorIndex >= currentPos && cursorIndex <= lineEnd) {
							currentLineIndex = i;
							col = cursorIndex - currentPos;
							break;
						}
						currentPos = lineEnd + 1;
					}
					if (currentLineIndex > 0) {
						const targetLineIndex = currentLineIndex - 1;
						const targetLineLen = lines[targetLineIndex]?.length ?? 0;
						const newCol = Math.min(col, targetLineLen);
						let newIndex = 0;
						for (let i = 0; i < targetLineIndex; i++) {
							newIndex += (lines[i]?.length ?? 0) + 1;
						}
						setCursorIndex(newIndex + newCol);
					}
					return;
				}

				if (key.downArrow) {
					const lines = input.split("\n");
					let currentLineIndex = 0;
					let currentPos = 0;
					let col = 0;
					for (let i = 0; i < lines.length; i++) {
						const line = lines[i];
						const lineLen = line?.length ?? 0;
						const lineEnd = currentPos + lineLen;
						if (cursorIndex >= currentPos && cursorIndex <= lineEnd) {
							currentLineIndex = i;
							col = cursorIndex - currentPos;
							break;
						}
						currentPos = lineEnd + 1;
					}
					if (currentLineIndex < lines.length - 1) {
						const targetLineIndex = currentLineIndex + 1;
						const targetLineLen = lines[targetLineIndex]?.length ?? 0;
						const newCol = Math.min(col, targetLineLen);
						let newIndex = 0;
						for (let i = 0; i < targetLineIndex; i++) {
							newIndex += (lines[i]?.length ?? 0) + 1;
						}
						setCursorIndex(newIndex + newCol);
					}
					return;
				}

				if (key.leftArrow) {
					setCursorIndex(Math.max(0, cursorIndex - 1));
					return;
				}

				if (key.rightArrow) {
					setCursorIndex(Math.min(input.length, cursorIndex + 1));
					return;
				}

				// Terminal-friendly fallback for deleting previous word.
				if (key.ctrl && typedInput === "w") {
					deleteWordBackward();
					return;
				}

				// Some mac terminal mappings emit Cmd+Backspace as Ctrl+U.
				if (key.ctrl && typedInput === "u") {
					deleteToLineStart();
					return;
				}

				// macOS typical editor behavior: Cmd+Delete clears to line start.
				if (
					(key.meta && key.backspace) ||
					(key.meta && key.delete && !key.backspace)
				) {
					deleteToLineStart();
					return;
				}

				if (key.backspace || key.delete) {
					if (cursorIndex > 0) {
						onInputChange(
							input.slice(0, cursorIndex - 1) + input.slice(cursorIndex),
						);
						setCursorIndex(cursorIndex - 1);
					}
					return;
				}

				if (typedInput) {
					insertAtCursor(typedInput);
				}
			};

			if (pendingBackslashRef.current) {
				pendingBackslashRef.current = false;
				if (rawKey.return) {
					// Terminal fallback: some Shift+Enter sequences emit "\" first.
					processInput("", { ...rawKey, meta: true } as Key);
					return;
				}
				processInput("\\", {} as Key);
			}

			if (rawInput === "\\") {
				pendingBackslashRef.current = true;
				return;
			}

			processInput(rawInput, rawKey);
		},
		{ isActive },
	);

	return (
		<Box marginTop={1} flexShrink={0} flexDirection="column" width={termCols}>
			<Box
				flexDirection="column"
				borderStyle="single"
				borderColor={INPUT_BORDER}
				width={termCols}
			>
				<Box
					paddingX={1}
					paddingY={0}
					width={termCols - 2}
					flexDirection="column"
				>
					<ControlledMultilineInput
						value={input}
						cursorIndex={cursorIndex}
						rows={1}
						maxRows={8}
						focus={!inputDisabled}
						placeholder={
							placeholder ?? '> Try "What needs my attention today?"'
						}
					/>
				</Box>
			</Box>
			{slashSuggestions.length > 0 ? (
				<Box marginTop={0} paddingX={1} flexDirection="column">
					{slashSuggestions.map((item) => {
						const selected = item.command === selectedSlashCommand?.command;
						return (
							<Box key={item.command} flexDirection="row" flexWrap="wrap">
								<Text color={selected ? "cyan" : "white"}>
									{selected ? "› " : "  "}
									{item.command}
								</Text>
								<Text dimColor> — {item.description}</Text>
							</Box>
						);
					})}
				</Box>
			) : null}
			<Box marginTop={0} paddingX={1}>
				<Text dimColor wrap="truncate-end">
					Type / to see commands · Shift/Alt+Enter newline · Enter to run ·
					Ctrl+C to quit
				</Text>
			</Box>
			<Box
				flexDirection="row"
				paddingX={1}
				marginTop={0}
				width={termCols}
				justifyContent="space-between"
			>
				<Box flexGrow={1} marginRight={1}>
					<Text dimColor wrap="truncate-end">
						{persona.name} · {modelLabel} · {scopeLabel}
						{dryRun ? " · dry-run" : ""}
					</Text>
				</Box>
				<Box flexShrink={0}>
					<Text dimColor wrap="truncate-start">
						{formatUsage(lastUsage) ?? " "}
					</Text>
				</Box>
			</Box>
		</Box>
	);
}
