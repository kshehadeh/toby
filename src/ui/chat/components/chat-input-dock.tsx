import type { LanguageModelUsage } from "ai";
import { Box, Text } from "ink";
import React, { useMemo } from "react";
import {
	extractTokenUsageReport,
	formatTokenUsageStatus,
} from "../../../ai/caching";
import { getAIProviderDisplayName } from "../../../ai/providers";
import type { Persona } from "../../../config/index";
import { DaemonStatusLine, MultilineTextEdit } from "../../shared";
import {
	detectTerminalProfile,
	inputModeLabel,
} from "../../shared/terminal-profile";
import { ACCENT, ACCENT_MODEL, ACCENT_PROVIDER } from "../constants";
import type { SlashCommand } from "../slash-commands";
import type { UpgradeUiStatus } from "../slash-commands/types";
import type { TobyUpdateInfo } from "../use-update-check";
import { formatUpdateStatusLine } from "../use-update-check";

function formatUpgradeUiStatusLine(status: UpgradeUiStatus): string | null {
	switch (status.status) {
		case "downloading":
			return status.progress !== null
				? `Downloading upgrade… ${status.progress}%`
				: "Downloading upgrade…";
		case "ready":
			return `Upgrade ready: v${status.version} · /restart to apply`;
		case "error":
			return `Upgrade failed: ${status.message}`;
		default:
			return null;
	}
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
	readonly updateAvailable?: TobyUpdateInfo | null;
	readonly upgradeUiStatus?: UpgradeUiStatus;
	readonly onShowKeyboardShortcuts?: () => void;
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
		updateAvailable = null,
		upgradeUiStatus = { status: "idle" },
		onShowKeyboardShortcuts,
	} = props;

	const placeholderText =
		(showPlaceholderWhenEmpty ?? false)
			? (placeholder ?? 'Try "What needs my attention today?"')
			: "";
	const showStaticPlaceholder =
		(showPlaceholderWhenEmpty ?? false) && input.length === 0;
	const contextFill = formatContextFill(modelLabel, lastUsage);
	const tokenUsageStatus = useMemo(() => {
		const report = extractTokenUsageReport(lastUsage, { persona });
		return formatTokenUsageStatus(report);
	}, [lastUsage, persona]);
	const terminalProfile = useMemo(() => detectTerminalProfile(), []);
	const modeLabel = inputModeLabel(terminalProfile);
	const updateStatusLine = updateAvailable
		? formatUpdateStatusLine(updateAvailable)
		: null;
	const upgradeStatusLine = formatUpgradeUiStatusLine(upgradeUiStatus);

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
				onEmptyQuestionMark={onShowKeyboardShortcuts}
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
					Type / to see commands
					{upgradeStatusLine ? (
						<>
							{" · "}
							<Text color={ACCENT}>{upgradeStatusLine}</Text>
						</>
					) : updateStatusLine ? (
						<>
							{" · "}
							<Text color={ACCENT}>{updateStatusLine}</Text>
						</>
					) : null}
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
							const providerLabel = getAIProviderDisplayName(
								persona.ai.provider,
							);
							const modelText = persona.ai.model;
							return (
								<>
									<Text color={ACCENT_PROVIDER} wrap="truncate-end">
										{providerLabel}
									</Text>
									<Text dimColor wrap="truncate-end">
										{" · "}
									</Text>
									<Text color={ACCENT_MODEL} wrap="truncate-end">
										{modelText}
									</Text>
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
					<DaemonStatusLine
						daemonRunning={daemonRunning}
						trailingText={tokenUsageStatus}
					/>
				</Box>
			</Box>
		</Box>
	);
}
