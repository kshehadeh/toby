import { Box, Text, useInput } from "ink";
import type { Key } from "ink";
import { MultilineInput } from "ink-multiline-input";
import React, { useCallback, useRef } from "react";
import type { Persona } from "../../../config/index";
import { INPUT_BORDER } from "../constants";
import type { SlashCommand } from "../slash-commands";

export function ChatInputDock({
	termCols,
	input,
	onInputChange,
	onInputSubmit,
	inputDisabled,
	persona,
	modelLabel,
	scopeLabel,
	dryRun,
	slashSuggestions,
	selectedSlashCommand,
}: {
	readonly termCols: number;
	readonly input: string;
	readonly onInputChange: (value: string) => void;
	readonly onInputSubmit: (value: string) => void;
	readonly inputDisabled: boolean;
	readonly persona: Persona;
	readonly modelLabel: string;
	readonly scopeLabel: string;
	readonly dryRun: boolean;
	readonly slashSuggestions: readonly SlashCommand[];
	readonly selectedSlashCommand: SlashCommand | null;
}) {
	const pendingBackslashRef = useRef(false);
	const useMultilineInput = useCallback(
		(inputHandler: (input: string, key: Key) => void, isActive: boolean) => {
			useInput(
				(input, key) => {
					if (!isActive) {
						return;
					}
					if (pendingBackslashRef.current) {
						pendingBackslashRef.current = false;
						if (key.return) {
							// Terminal fallback: some Shift+Enter sequences emit "\" first.
							inputHandler("", { ...key, meta: true } as Key);
							return;
						}
						inputHandler("\\", {} as Key);
					}
					if (input === "\\") {
						pendingBackslashRef.current = true;
						return;
					}
					inputHandler(input, key);
				},
				{ isActive },
			);
		},
		[],
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
					<MultilineInput
						value={input}
						onChange={onInputChange}
						onSubmit={onInputSubmit}
						rows={1}
						maxRows={8}
						focus={!inputDisabled}
						placeholder='> Try "What needs my attention today?"'
						keyBindings={{
							submit: (key) =>
								key.return && !key.shift && !key.meta && !key.ctrl,
							newline: (key) =>
								key.return && (key.shift || key.meta || key.ctrl),
						}}
						useCustomInput={useMultilineInput}
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
					<Text color="green">✓</Text>
				</Box>
			</Box>
		</Box>
	);
}
