import type { Persona } from "@toby/core/config/index";
import type { LanguageModelUsage } from "ai";
import React, {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useState,
} from "react";
import type { SlashCommand } from "../slash-commands";
import { getSlashSuggestions } from "../slash-commands";
import type { UpgradeUiStatus } from "../slash-commands/types";
import type { TobyUpdateInfo } from "../use-update-check";
import { ChatInputDock } from "./chat-input-dock";

export type ChatInputPanelHandle = {
	readonly getInput: () => string;
	readonly setInput: (value: string) => void;
	readonly clearInput: () => void;
	readonly bumpCursorReset: () => void;
	readonly getSelectedSlashCommand: () => SlashCommand | null;
};

export type ChatInputPanelProps = {
	readonly termCols: number;
	readonly onSubmit: (
		value: string,
		selectedSlashCommand: SlashCommand | null,
	) => void;
	readonly inputDisabled: boolean;
	readonly persona: Persona;
	readonly modelLabel: string;
	readonly dryRun: boolean;
	readonly lastUsage: LanguageModelUsage | null;
	readonly placeholder?: string | null;
	readonly showPlaceholderWhenEmpty?: boolean;
	readonly daemonRunning: boolean;
	readonly recentPrompts?: readonly string[];
	readonly updateAvailable?: TobyUpdateInfo | null;
	readonly upgradeUiStatus?: UpgradeUiStatus;
	readonly onShowKeyboardShortcuts?: () => void;
	readonly loading?: boolean;
	readonly isListenRecording?: boolean;
};

export const ChatInputPanel = forwardRef<
	ChatInputPanelHandle,
	ChatInputPanelProps
>(function ChatInputPanel(props, ref) {
	const {
		termCols,
		onSubmit,
		inputDisabled,
		persona,
		modelLabel,
		dryRun,
		lastUsage,
		placeholder,
		showPlaceholderWhenEmpty,
		daemonRunning,
		recentPrompts = [],
		updateAvailable = null,
		upgradeUiStatus = { status: "idle" },
		onShowKeyboardShortcuts,
		loading = false,
		isListenRecording = false,
	} = props;

	const [input, setInput] = useState("");
	const [cursorResetToken, setCursorResetToken] = useState(0);
	const [slashCursorIndex, setSlashCursorIndex] = useState(0);

	const slashSuggestions = useMemo(() => getSlashSuggestions(input), [input]);

	useEffect(() => {
		setSlashCursorIndex((prev) => {
			if (slashSuggestions.length === 0) {
				return 0;
			}
			return Math.min(prev, slashSuggestions.length - 1);
		});
	}, [slashSuggestions]);

	const selectedSlashCommand =
		slashSuggestions.length > 0
			? (slashSuggestions[slashCursorIndex] ?? slashSuggestions[0] ?? null)
			: null;

	const selectedSlashCommandRef = React.useRef(selectedSlashCommand);
	selectedSlashCommandRef.current = selectedSlashCommand;

	const inputRef = React.useRef(input);
	inputRef.current = input;

	useImperativeHandle(
		ref,
		() => ({
			getInput: () => inputRef.current,
			setInput: (value: string) => {
				setInput(value);
			},
			clearInput: () => {
				setInput("");
				setCursorResetToken((token) => token + 1);
			},
			bumpCursorReset: () => {
				setCursorResetToken((token) => token + 1);
			},
			getSelectedSlashCommand: () => selectedSlashCommandRef.current,
		}),
		[],
	);

	const handleSubmit = useCallback(
		(value: string) => {
			onSubmit(value, selectedSlashCommandRef.current);
		},
		[onSubmit],
	);

	return (
		<ChatInputDock
			termCols={termCols}
			input={input}
			onInputChange={setInput}
			onInputSubmit={handleSubmit}
			cursorResetToken={cursorResetToken}
			inputDisabled={inputDisabled}
			persona={persona}
			modelLabel={modelLabel}
			dryRun={dryRun}
			lastUsage={lastUsage}
			placeholder={placeholder}
			showPlaceholderWhenEmpty={showPlaceholderWhenEmpty}
			slashSuggestions={slashSuggestions}
			selectedSlashCommand={selectedSlashCommand}
			daemonRunning={daemonRunning}
			recentPrompts={recentPrompts}
			updateAvailable={updateAvailable}
			upgradeUiStatus={upgradeUiStatus}
			onShowKeyboardShortcuts={onShowKeyboardShortcuts}
			loading={loading}
			isListenRecording={isListenRecording}
		/>
	);
});
