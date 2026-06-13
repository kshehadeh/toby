import {
	extractTokenUsageReport,
	formatTokenUsageStatus,
} from "@toby/core/ai/caching";
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

function getModelContextWindow(model: string): number | null {
	const m = model.toLowerCase().trim();

	// OpenAI
	if (
		m.startsWith("gpt-4.1") ||
		m.startsWith("gpt-5") ||
		m.startsWith("o3") ||
		m.startsWith("o4")
	) {
		return 1_000_000;
	}
	if (m.startsWith("gpt-4o") || m.startsWith("gpt-4-turbo")) {
		return 128_000;
	}

	// Anthropic
	if (m.includes("claude-opus") || m.includes("claude-sonnet")) {
		return 1_000_000;
	}
	if (m.includes("claude-haiku")) {
		return 200_000;
	}

	// Google Gemini
	if (m.startsWith("gemini-3") || m.startsWith("gemini-2.5")) {
		return 1_000_000;
	}

	// Amazon Nova
	if (m.startsWith("nova")) {
		return 300_000;
	}

	// Meta Llama
	if (m.includes("llama-4-scout")) {
		return 10_000_000;
	}

	// Mistral
	if (m.startsWith("mistral-medium")) {
		return 131_000;
	}

	// DeepSeek
	if (m.startsWith("deepseek")) {
		return 128_000;
	}

	// xAI Grok
	if (m.includes("grok-4")) {
		return 2_000_000;
	}

	// Zhipu GLM
	if (m.includes("glm-5")) {
		return 1_000_000;
	}
	if (m.includes("glm-4.7-flash")) {
		return 131_000;
	}
	if (m.includes("glm-4.7")) {
		return 200_000;
	}

	// Moonshot Kimi
	if (m.includes("kimi-k2.6")) {
		return 262_000;
	}
	if (m.includes("kimi-k2.5")) {
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
	readonly project?: { readonly name: string } | null;
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
