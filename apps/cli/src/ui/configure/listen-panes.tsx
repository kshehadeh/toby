import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import type {
	ListenSession,
	ListenSourceSelection,
	ListenState,
} from "../../listen/types";
import { formatListenSources } from "../../listen/types";
import { ACCENT } from "../chat/constants";
import { SelectableTextRow, UI_GLYPHS } from "../shared";

const RECORDING_DOT_FRAMES = ["⏺", " "];
const RECORDING_DOT_INTERVAL_MS = 600;

function RecordingIndicator({ active }: { readonly active: boolean }) {
	const [frame, setFrame] = useState(0);
	useEffect(() => {
		if (!active) return;
		const id = setInterval(
			() => setFrame((f) => (f + 1) % 2),
			RECORDING_DOT_INTERVAL_MS,
		);
		return () => clearInterval(id);
	}, [active]);
	if (!active) return null;
	return (
		<Text color="red" bold>
			{RECORDING_DOT_FRAMES[frame]}
		</Text>
	);
}

export function ListenRecordingView({
	state,
	elapsed,
	focusIndex,
}: {
	readonly state: ListenState;
	readonly elapsed: string;
	readonly focusIndex: number;
}) {
	const isListening = state.status === "listening";
	const isRequesting = state.status === "requestingPermission";
	const isStopping = state.status === "stopping";

	const actionItems = [
		{ id: "save", label: "Stop and Save", color: "green" as const },
		{ id: "discard", label: "Stop and Discard", color: "red" as const },
	];

	return (
		<Box flexDirection="column">
			<Box flexDirection="row" alignItems="center" gap={1} paddingX={1}>
				<RecordingIndicator active={isListening} />
				<Text bold color={isListening ? "red" : "yellow"}>
					Recording
				</Text>
			</Box>

			<Box paddingX={1} marginTop={1}>
				<Text bold>
					Elapsed: <Text color={ACCENT}>{elapsed}</Text>
				</Text>
			</Box>

			{state.message && !isListening ? (
				<Box paddingX={1} marginTop={1}>
					<Text dimColor>{state.message}</Text>
				</Box>
			) : null}

			{state.error ? (
				<Box paddingX={1} marginTop={1}>
					<Text color="red" wrap="wrap">
						{state.error}
					</Text>
				</Box>
			) : null}

			{isListening || isStopping ? (
				<Box flexDirection="column" marginTop={1}>
					{actionItems.map((item, i) => (
						<SelectableTextRow key={item.id} selected={i === focusIndex}>
							<Text bold color={item.color}>
								{UI_GLYPHS.action} {item.label}
							</Text>
						</SelectableTextRow>
					))}
				</Box>
			) : null}

			{isRequesting ? (
				<Box paddingX={1} marginTop={1}>
					<Text dimColor>Waiting for permissions…</Text>
				</Box>
			) : null}

			<Box paddingX={1} marginTop={1}>
				<Text dimColor>{formatListenSources(state.sources)}</Text>
			</Box>
		</Box>
	);
}

export function ListenStartPane({
	sources,
	focusIndex,
}: {
	readonly sources: ListenSourceSelection;
	readonly focusIndex: number;
}) {
	const items = [
		{
			id: "mic",
			label: `${sources.mic ? UI_GLYPHS.checkboxOn : UI_GLYPHS.checkboxOff} Microphone`,
			color: sources.mic ? "green" : "gray",
		},
		{
			id: "system",
			label: `${sources.system ? UI_GLYPHS.checkboxOn : UI_GLYPHS.checkboxOff} System audio`,
			color: sources.system ? "green" : "gray",
		},
	];

	return (
		<Box flexDirection="column">
			<Box paddingX={1}>
				<Text bold color={ACCENT}>
					{UI_GLYPHS.action} Start a New Recording
				</Text>
			</Box>
			<Box paddingX={1} marginTop={1}>
				<Text dimColor>
					Select sources, then press Enter on "Start new recording" in the tree.
				</Text>
			</Box>
			<Box flexDirection="column" marginTop={1}>
				{items.map((item, i) => (
					<SelectableTextRow key={item.id} selected={i === focusIndex}>
						<Text color={item.color}>{item.label}</Text>
					</SelectableTextRow>
				))}
			</Box>
		</Box>
	);
}

export function formatListenElapsed(
	session: ListenSession | undefined,
): string {
	if (!session) return "0:00";
	const elapsedMs = Math.max(0, Date.now() - Date.parse(session.startedAt));
	const totalSeconds = Math.floor(elapsedMs / 1000);
	const mins = Math.floor(totalSeconds / 60);
	const secs = totalSeconds % 60;
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatListenDuration(ms: number | undefined): string {
	if (ms === undefined) return "";
	const totalSeconds = Math.round(ms / 1000);
	const mins = Math.floor(totalSeconds / 60);
	const secs = totalSeconds % 60;
	return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export function formatListenRecordingDate(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString();
}

export function listenRecordingTreeLabel(
	startedAt: string | undefined,
	createdAt: string,
	name: string | undefined,
	id: string,
): string {
	const title =
		name?.trim() || formatListenRecordingDate(startedAt || createdAt) || id;
	return title;
}
