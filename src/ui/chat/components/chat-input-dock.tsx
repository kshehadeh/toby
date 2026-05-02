import type { LanguageModelUsage } from "ai";
import { Box, Text, useInput } from "ink";
import type { Key } from "ink";
import { ControlledMultilineInput } from "ink-multiline-input";
import React, { useEffect, useRef, useState } from "react";
import type { Persona } from "../../../config/index";
import { resolveDeleteShortcutAction } from "../input-keymap";
import { reconcileCursorIndex } from "../input-cursor";
import {
	ACCENT,
	ACCENT_MODEL,
	ACCENT_PROVIDER,
	INPUT_BORDER,
} from "../constants";
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

function getModelContextWindow(model: string): number | null {
	const m = model.toLowerCase().trim();
	if (
		m.startsWith("gpt-4.1") ||
		m.startsWith("gpt-5") ||
		m.startsWith("o3") ||
		m.startsWith("o4")
	) {
		// Current OpenAI long-context families used in Toby are ~1M context.
		return 1_000_000;
	}
	if (m.startsWith("gpt-4o") || m.startsWith("gpt-4-turbo")) {
		return 128_000;
	}
	return null;
}

function formatContextFill(
	modelLabel: string,
	usage: LanguageModelUsage | null,
): string | null {
	const input = usage?.inputTokens;
	if (typeof input !== "number" || input <= 0) {
		return null;
	}
	const [, modelPart] = modelLabel.split("/", 2);
	const model = modelPart ?? modelLabel;
	const windowSize = getModelContextWindow(model);
	if (!windowSize) {
		return null;
	}
	const pct = Math.max(
		0,
		Math.min(100, Math.round((input / windowSize) * 100)),
	);
	return `ctx ${pct}%`;
}

type ChatInputDockProps = {
	readonly termCols: number;
	readonly input: string;
	readonly onInputChange: (value: string) => void;
	readonly onInputSubmit: (value: string) => void;
	readonly cursorResetToken?: number;
	readonly inputDisabled: boolean;
	readonly persona: Persona;
	readonly modelLabel: string;
	readonly dryRun: boolean;
	readonly lastUsage: LanguageModelUsage | null;
	readonly placeholder?: string | null;
	readonly showPlaceholderWhenEmpty?: boolean;
	readonly slashSuggestions: readonly SlashCommand[];
	readonly selectedSlashCommand: SlashCommand | null;
};

export function ChatInputDock(props: ChatInputDockProps) {
	const {
		termCols,
		input,
		onInputChange,
		onInputSubmit,
		cursorResetToken = 0,
		inputDisabled,
		persona,
		modelLabel,
		dryRun,
		lastUsage,
		placeholder,
		showPlaceholderWhenEmpty,
		slashSuggestions,
		selectedSlashCommand,
	} = props;

	const pendingBackslashRef = useRef(false);
	const [cursorIndex, setCursorIndex] = useState(input.length);
	const previousCursorResetTokenRef = useRef(cursorResetToken);

	useEffect(() => {
		const forceResetToEnd =
			previousCursorResetTokenRef.current !== cursorResetToken;
		previousCursorResetTokenRef.current = cursorResetToken;
		setCursorIndex((prev) =>
			reconcileCursorIndex({
				currentCursorIndex: prev,
				nextInputLength: input.length,
				forceResetToEnd,
			}),
		);
	}, [cursorResetToken, input.length]);

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

	const insertAtCursor = (text: string) => {
		const next = input.slice(0, cursorIndex) + text + input.slice(cursorIndex);
		onInputChange(next);
		setCursorIndex(cursorIndex + text.length);
	};

	const isActive = !inputDisabled;
	const placeholderText = placeholder ?? 'Try "What needs my attention today?"';
	const showStaticPlaceholder =
		(showPlaceholderWhenEmpty ?? false) && input.length === 0;
	const contextFill = formatContextFill(modelLabel, lastUsage);
	useInput(
		(rawInput, rawKey) => {
			if (!isActive) {
				return;
			}

			const processInput = (typedInput: string, key: Key) => {
				// Ink maps CR (`\r`) to `key.return` but LF (`\n`) is parsed as `enter`, so
				// `key.return` stays false — plain Enter then falls through and inserts `\n`.
				const isEnter =
					key.return || typedInput === "\n" || typedInput === "\r";
				const shouldSubmit = isEnter && !key.shift && !key.meta && !key.ctrl;
				const shouldNewline = isEnter && (key.shift || key.meta || key.ctrl);

				if (shouldSubmit) {
					onInputSubmit(input);
					return;
				}

				if (shouldNewline) {
					insertAtCursor("\n");
					return;
				}

				// Ignore stray newline chars from Enter-like sequences not handled above.
				if (typedInput === "\r" || typedInput === "\n") {
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

				const deleteAction = resolveDeleteShortcutAction(typedInput, key);
				if (deleteAction === "delete-word-backward") {
					deleteWordBackward();
					return;
				}
				if (deleteAction === "delete-char") {
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
		<Box marginTop={0} flexShrink={0} flexDirection="column" width={termCols}>
			<Box
				flexDirection="column"
				borderStyle="single"
				borderColor={INPUT_BORDER}
				width={termCols}
			>
				<Box paddingX={1} paddingY={0} width={termCols - 2} flexDirection="row">
					<Box flexShrink={0}>
						<Text color={ACCENT} bold>
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
								value={input}
								cursorIndex={cursorIndex}
								rows={1}
								maxRows={8}
								focus={!inputDisabled}
								placeholder={placeholderText}
							/>
						)}
					</Box>
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
					Type / to see commands · Shift+Enter newline · Enter to run · Ctrl+C
					to quit
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
					<Box flexDirection="row" flexWrap="wrap">
						<Text bold wrap="truncate-end">
							{persona.name}
						</Text>
						<Text dimColor wrap="truncate-end">
							{" · "}
						</Text>
						{(() => {
							const [provider, model] = modelLabel.split("/", 2);
							return (
								<>
									<Text color={ACCENT_PROVIDER} wrap="truncate-end">
										{provider ?? modelLabel}
									</Text>
									<Text dimColor wrap="truncate-end">
										{model ? "/" : ""}
									</Text>
									{model ? (
										<Text color={ACCENT_MODEL} wrap="truncate-end">
											{model}
										</Text>
									) : null}
									{contextFill ? (
										<>
											<Text dimColor wrap="truncate-end">
												{" · "}
											</Text>
											<Text dimColor wrap="truncate-end">
												{contextFill}
											</Text>
										</>
									) : null}
								</>
							);
						})()}
						{dryRun ? (
							<Text dimColor wrap="truncate-end">
								{" · "}dry-run
							</Text>
						) : null}
					</Box>
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
