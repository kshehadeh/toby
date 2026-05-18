import type { LanguageModelUsage } from "ai";
import { Box, Text } from "ink";
import React, { useMemo } from "react";
import type { Persona } from "../../../config/index";
import { MultilineTextEdit, newlineHintText } from "../../shared";
import {
	detectTerminalProfile,
	inputModeLabel,
} from "../../shared/terminal-profile";
import { ACCENT, ACCENT_MODEL, ACCENT_PROVIDER } from "../constants";
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
	readonly daemonRunning: boolean;
	readonly recentPrompts?: readonly string[];
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
		daemonRunning,
		recentPrompts = [],
	} = props;

	const placeholderText = placeholder ?? 'Try "What needs my attention today?"';
	const showStaticPlaceholder =
		(showPlaceholderWhenEmpty ?? false) && input.length === 0;
	const contextFill = formatContextFill(modelLabel, lastUsage);
	const terminalProfile = useMemo(() => detectTerminalProfile(), []);
	const modeLabel = inputModeLabel(terminalProfile);
	const newlineHint = newlineHintText(terminalProfile);

	return (
		<Box marginTop={0} flexShrink={0} flexDirection="column" width={termCols}>
			<MultilineTextEdit
				width={termCols}
				value={input}
				onChange={onInputChange}
				onSubmit={onInputSubmit}
				focus={!inputDisabled}
				cursorResetToken={cursorResetToken}
				placeholder={placeholderText}
				accentColor={ACCENT}
				showStaticPlaceholder={showStaticPlaceholder}
				recentPrompts={recentPrompts}
			/>
			{slashSuggestions.length > 0 ? (
				<Box marginTop={0} paddingX={1} flexDirection="column">
					{slashSuggestions.map((item) => {
						const selected = item.command === selectedSlashCommand?.command;
						return (
							<Box key={item.command} flexDirection="row" flexWrap="wrap">
								<Text color={selected ? ACCENT : "white"}>
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
					Type / to see commands · ↑↓ recent prompts (when empty) ·{" "}
					{newlineHint} · Enter to run · Shift+Tab cycle persona · Ctrl+C to
					quit
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
						<Text dimColor wrap="truncate-end">
							{" · "}
							{modeLabel}
						</Text>
					</Box>
				</Box>
				<Box flexShrink={0}>
					<Text dimColor wrap="truncate-start">
						{"Daemon "}
						{daemonRunning ? (
							<Text color="green">✔︎</Text>
						) : (
							<Text color="red">✗</Text>
						)}
						{formatUsage(lastUsage) ? ` · ${formatUsage(lastUsage)}` : ""}
					</Text>
				</Box>
			</Box>
		</Box>
	);
}
