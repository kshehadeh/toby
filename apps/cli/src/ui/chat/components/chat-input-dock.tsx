import {
	extractTokenUsageReport,
	formatTokenUsageStatus,
} from "@toby/core/ai/caching";
import type { AIContextWindowInfo } from "@toby/core/ai/context-window";
import { getAIProviderDisplayName } from "@toby/core/ai/providers";
import type { Persona } from "@toby/core/config/index";
import type { LanguageModelUsage } from "ai";
import { Box, Text } from "ink";
import React, { useEffect, useMemo, useState } from "react";
import {
	DaemonStatusLine,
	MultilineTextEdit,
	dotGridSpinnerFrame,
} from "../../shared";
import {
	detectTerminalProfile,
	inputModeLabel,
} from "../../shared/terminal-profile";
import { ACCENT, ACCENT_MODEL, ACCENT_PROVIDER, TIP_LABEL } from "../constants";
import type { SlashCommand } from "../slash-commands";
import type { UpgradeUiStatus } from "../slash-commands/types";
import type { TobyUpdateInfo } from "../use-update-check";
import { formatUpdateStatusLine } from "../use-update-check";

const UPGRADE_PROGRESS_BAR_WIDTH = 12;

function renderUpgradeProgressBar(percent: number): string {
	const clamped = Math.max(0, Math.min(100, percent));
	const filled = Math.round((clamped / 100) * UPGRADE_PROGRESS_BAR_WIDTH);
	return `${"█".repeat(filled)}${"░".repeat(UPGRADE_PROGRESS_BAR_WIDTH - filled)}`;
}

function formatUpgradeUiStatusLine(
	status: UpgradeUiStatus,
	frame: number,
): string | null {
	switch (status.status) {
		case "downloading": {
			const spinner = dotGridSpinnerFrame(frame);
			if (status.progress !== null) {
				return `${spinner} Downloading upgrade ${renderUpgradeProgressBar(status.progress)} ${status.progress}%`;
			}
			return `${spinner} Downloading upgrade…`;
		}
		case "extracting":
			return `${dotGridSpinnerFrame(frame)} Extracting upgrade…`;
		case "verifying":
			return `${dotGridSpinnerFrame(frame)} Verifying upgrade…`;
		case "ready":
			return `Upgrade ready: v${status.version} · /restart to apply`;
		case "error":
			return `Upgrade failed: ${status.message}`;
		default:
			return null;
	}
}

function formatContextFill(
	contextWindow: AIContextWindowInfo | null,
): string | null {
	if (!contextWindow?.supported) {
		return null;
	}
	if (typeof contextWindow.fillPercentage !== "number") {
		return null;
	}
	return `ctx ${contextWindow.fillPercentage}%`;
}

type ChatInputDockProps = {
	readonly termCols: number;
	readonly input: string;
	readonly onInputChange: (value: string) => void;
	readonly onInputSubmit: (value: string) => void;
	readonly cursorResetToken?: number;
	readonly inputDisabled: boolean;
	readonly persona: Persona;
	readonly project?: { readonly name: string } | null;
	readonly modelLabel: string;
	readonly dryRun: boolean;
	readonly lastUsage: LanguageModelUsage | null;
	readonly contextWindow: AIContextWindowInfo | null;
	readonly placeholder?: string | null;
	readonly showPlaceholderWhenEmpty?: boolean;
	readonly slashSuggestions: readonly SlashCommand[];
	readonly selectedSlashCommand: SlashCommand | null;
	readonly daemonRunning: boolean;
	readonly recentPrompts?: readonly string[];
	readonly updateAvailable?: TobyUpdateInfo | null;
	readonly upgradeUiStatus?: UpgradeUiStatus;
	readonly onShowKeyboardShortcuts?: () => void;
	readonly loading?: boolean;
	readonly isListenRecording?: boolean;
	readonly tip?: string;
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
		project,
		modelLabel,
		dryRun,
		lastUsage,
		contextWindow,
		placeholder,
		showPlaceholderWhenEmpty,
		slashSuggestions,
		selectedSlashCommand,
		daemonRunning,
		recentPrompts = [],
		updateAvailable = null,
		upgradeUiStatus = { status: "idle" },
		onShowKeyboardShortcuts,
		loading = false,
		isListenRecording = false,
		tip,
	} = props;

	const placeholderText = loading
		? "Submit steering prompt"
		: (showPlaceholderWhenEmpty ?? false)
			? (placeholder ?? 'Try "What needs my attention today?"')
			: "";
	const showStaticPlaceholder =
		input.length === 0 && (loading || (showPlaceholderWhenEmpty ?? false));
	const contextFill = formatContextFill(contextWindow);
	const tokenUsageStatus = useMemo(() => {
		const report = extractTokenUsageReport(lastUsage, { persona });
		return formatTokenUsageStatus(report);
	}, [lastUsage, persona]);
	const terminalProfile = useMemo(() => detectTerminalProfile(), []);
	const modeLabel = inputModeLabel(terminalProfile);
	const updateStatusLine = updateAvailable
		? formatUpdateStatusLine(updateAvailable)
		: null;
	const [dotFrame, setDotFrame] = useState(0);
	useEffect(() => {
		if (!isListenRecording) {
			setDotFrame(0);
			return;
		}
		const id = setInterval(() => setDotFrame((f) => (f + 1) % 2), 600);
		return () => clearInterval(id);
	}, [isListenRecording]);
	const isUpgradeInProgress =
		upgradeUiStatus.status === "downloading" ||
		upgradeUiStatus.status === "extracting" ||
		upgradeUiStatus.status === "verifying";
	const [upgradeSpinnerFrame, setUpgradeSpinnerFrame] = useState(0);
	useEffect(() => {
		if (!isUpgradeInProgress) {
			setUpgradeSpinnerFrame(0);
			return;
		}
		const id = setInterval(() => {
			setUpgradeSpinnerFrame((f) => f + 1);
		}, 100);
		return () => clearInterval(id);
	}, [isUpgradeInProgress]);
	const upgradeStatusLine = formatUpgradeUiStatusLine(
		upgradeUiStatus,
		upgradeSpinnerFrame,
	);

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
			{isListenRecording ? (
				<Box marginTop={0} paddingX={1}>
					<Text bold color="red">
						{dotFrame === 0 ? "⏺" : " "} Recording — /stop-listening to save
					</Text>
				</Box>
			) : null}
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
				<Text wrap="truncate-end">
					{tip ? (
						<>
							<Text color={ACCENT}>{TIP_LABEL}</Text>
							<Text dimColor>{tip}</Text>
						</>
					) : null}
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
						{project ? (
							<>
								<Text dimColor wrap="truncate-end">
									{" · "}
								</Text>
								<Text color="cyan" wrap="truncate-end">
									{project.name}
								</Text>
							</>
						) : null}
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
