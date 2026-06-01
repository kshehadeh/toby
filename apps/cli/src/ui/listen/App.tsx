import { Box, Text, render, useApp, useInput } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type AudioCaptureHandle,
	type AudioHelperEvent,
	ListenCaptureError,
	startMacOSAudioCapture,
	waitForAudioHelperExit,
} from "../../listen/macos/audio-capture";
import {
	buildListenMetadata,
	createInitialListenState,
	deleteListenRecording,
	discardListenSession,
	listListenRecordings,
	openListenRecordingInFinder,
	prepareListenSession,
	resolveListenRecordingsDir,
	saveListenSession,
	updateListenRecordingMetadata,
} from "../../listen/session-controller";
import type { ListenRecordingSummary } from "../../listen/session-controller";
import type {
	ListenRecordingFiles,
	ListenSession,
	ListenSourceSelection,
	ListenState,
} from "../../listen/types";
import { formatListenSources } from "../../listen/types";
import { ACCENT } from "../chat/constants";
import {
	ActionRow,
	ConfirmDialog,
	FieldEditor,
	NavigatorRow,
	SelectableTextRow,
	StatusIcon,
	TwoPaneView,
	UI_GLYPHS,
	detectTerminalProfile,
	isBackKey,
	isNavigateDown,
	isNavigateUp,
	isQuitKey,
	isSelectKey,
	isToggleKey,
	resolveKittyKeyboardMode,
	useTwoPaneNavigation,
} from "../shared";

export interface ListenAppOptions {
	readonly sources: ListenSourceSelection;
	readonly helperPath?: string;
	readonly recordingsDir?: string;
}

type ConfirmAction = "discard" | "quit" | "deleteRecording";
type EditRecordingField = "name" | "description";

const RECORDING_DOT_FRAMES = ["⏺", " "];
const RECORDING_DOT_INTERVAL_MS = 600;

function formatElapsed(session: ListenSession | undefined): string {
	if (!session) return "0:00";
	const elapsedMs = Math.max(0, Date.now() - Date.parse(session.startedAt));
	const totalSeconds = Math.floor(elapsedMs / 1000);
	const mins = Math.floor(totalSeconds / 60);
	const secs = totalSeconds % 60;
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDuration(ms: number | undefined): string {
	if (ms === undefined) return "";
	const totalSeconds = Math.round(ms / 1000);
	const mins = Math.floor(totalSeconds / 60);
	const secs = totalSeconds % 60;
	return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function formatRecordingDate(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString();
}

function recordingLabel(recording: ListenRecordingSummary): string {
	const duration = formatDuration(recording.metadata.durationMs);
	const date = formatRecordingDate(
		recording.metadata.startedAt || recording.metadata.createdAt,
	);
	const title = recording.metadata.name?.trim() || date;
	return `${title}${duration ? ` · ${duration}` : ""}`;
}

function helperErrorMessage(error: unknown): string {
	if (error instanceof ListenCaptureError) return error.message;
	return error instanceof Error ? error.message : String(error);
}

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

function RecordingView({
	state,
	elapsed,
	onSave,
	onDiscard,
	focusIndex,
}: {
	readonly state: ListenState;
	readonly elapsed: string;
	readonly onSave: () => void;
	readonly onDiscard: () => void;
	readonly focusIndex: number;
}) {
	const isListening = state.status === "listening";
	const isRequesting = state.status === "requestingPermission";
	const isStopping = state.status === "stopping";
	const isSaving = isStopping && state.message?.includes("saving");

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

function RecordingDetailView({
	recording,
	focusIndex,
	onOpenFinder,
	onDelete,
}: {
	readonly recording: ListenRecordingSummary;
	readonly focusIndex: number;
	readonly onOpenFinder: () => void;
	readonly onDelete: () => void;
}) {
	const rows = [
		{
			kind: "field" as const,
			field: "name",
			label: "Name",
			value: recording.metadata.name ?? "",
		},
		{
			kind: "field" as const,
			field: "description",
			label: "Description",
			value: recording.metadata.description ?? "",
			multiline: true,
		},
		{
			kind: "field" as const,
			field: "location",
			label: "Location",
			value: recording.dir,
		},
		{
			kind: "info" as const,
			label: "Duration",
			value: formatDuration(recording.metadata.durationMs) || "N/A",
		},
		{
			kind: "info" as const,
			label: "Date",
			value: formatRecordingDate(
				recording.metadata.startedAt || recording.metadata.createdAt,
			),
		},
		{
			kind: "info" as const,
			label: "Sources",
			value: formatListenSources(recording.metadata.sources),
		},
		{ kind: "action" as const, action: "open", label: "Open folder in Finder" },
		{ kind: "delete" as const, action: "delete", label: "Delete recording" },
	];

	return (
		<Box flexDirection="column">
			<Box paddingX={1}>
				<Text bold color={ACCENT}>
					{UI_GLYPHS.section} {recording.metadata.name || recording.id}
				</Text>
			</Box>
			{recording.metadata.description ? (
				<Box paddingX={1} marginTop={1}>
					<Text dimColor>{recording.metadata.description}</Text>
				</Box>
			) : null}
			<Box flexDirection="column" marginTop={1}>
				{rows.map((row, i) => {
					const selected = i === focusIndex;
					if (row.kind === "field") {
						return (
							<NavigatorRow
								key={row.field}
								label={row.label}
								kind={row.field === "location" ? "value" : "value"}
								selected={selected}
								currentValue={row.value}
								multiline={row.multiline}
							/>
						);
					}
					if (row.kind === "info") {
						return (
							<NavigatorRow
								key={row.label}
								label={row.label}
								kind="value"
								selected={selected}
								currentValue={row.value}
							/>
						);
					}
					return (
						<ActionRow
							key={row.action}
							label={row.label}
							selected={selected}
							kind={row.kind === "delete" ? "delete" : "action"}
						/>
					);
				})}
			</Box>
		</Box>
	);
}

function IdleStartView({
	sources,
	focusIndex,
	onToggleMic,
	onToggleSystem,
}: {
	readonly sources: ListenSourceSelection;
	readonly focusIndex: number;
	readonly onToggleMic: () => void;
	readonly onToggleSystem: () => void;
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
					Select sources, then press Enter on "Start" in the list.
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

type LeftPaneItem =
	| { readonly kind: "start" }
	| { readonly kind: "recording"; readonly recording: ListenRecordingSummary };

function ListenApp({
	sources: initialSources,
	helperPath,
	recordingsDir,
}: ListenAppOptions) {
	const { exit } = useApp();
	const [state, setState] = useState<ListenState>(() =>
		createInitialListenState(initialSources),
	);
	const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(
		null,
	);
	const [editField, setEditField] = useState<{
		readonly field: EditRecordingField;
		readonly recording: ListenRecordingSummary;
	} | null>(null);
	const [elapsed, setElapsed] = useState("0:00");
	const [recordings, setRecordings] = useState<ListenRecordingSummary[]>(() =>
		listListenRecordings(recordingsDir),
	);
	const [dotFrame, setDotFrame] = useState(0);
	const handleRef = useRef<AudioCaptureHandle | null>(null);
	const helperVersionRef = useRef<string | undefined>(undefined);
	const filesRef = useRef<ListenRecordingFiles>({});
	const errorsRef = useRef<string[]>([]);

	const leftItems = useMemo((): LeftPaneItem[] => {
		const items: LeftPaneItem[] = [{ kind: "start" }];
		for (const recording of recordings) {
			items.push({ kind: "recording", recording });
		}
		return items;
	}, [recordings]);

	const {
		focusedPane,
		setFocusedPane,
		leftIndex,
		setLeftIndex,
		rightIndex,
		setRightIndex,
		toggleFocus,
	} = useTwoPaneNavigation({ leftCount: leftItems.length });

	const selectedItem = leftItems[leftIndex] ?? leftItems[0];
	const isRecording =
		state.status === "listening" ||
		state.status === "requestingPermission" ||
		state.status === "stopping";

	const selectedRecording = useMemo(() => {
		if (selectedItem?.kind === "recording") return selectedItem.recording;
		return null;
	}, [selectedItem]);

	const isStartSelected = selectedItem?.kind === "start";

	// Animated recording dot
	useEffect(() => {
		if (state.status !== "listening") {
			setDotFrame(0);
			return;
		}
		const id = setInterval(
			() => setDotFrame((f) => (f + 1) % 2),
			RECORDING_DOT_INTERVAL_MS,
		);
		return () => clearInterval(id);
	}, [state.status]);

	// Elapsed timer
	useEffect(() => {
		if (state.status !== "listening" || !state.session) {
			setElapsed(formatElapsed(state.session));
			return;
		}
		const interval = setInterval(() => {
			setElapsed(formatElapsed(state.session));
		}, 1000);
		return () => clearInterval(interval);
	}, [state.status, state.session]);

	// Cleanup handle on unmount
	useEffect(() => {
		return () => {
			handleRef.current?.dispose();
		};
	}, []);

	const refreshRecordings = useCallback(() => {
		setRecordings(listListenRecordings(recordingsDir));
	}, [recordingsDir]);

	const onHelperEvent = useCallback((event: AudioHelperEvent) => {
		if (event.type === "ready") {
			helperVersionRef.current = event.helperVersion;
			filesRef.current = { ...filesRef.current, ...(event.files ?? {}) };
			setState((prev) => ({
				...prev,
				status: "listening",
				message: "Listening. Press s to stop and save.",
			}));
			return;
		}
		if (event.type === "status") {
			setState((prev) => ({ ...prev, message: event.message }));
			return;
		}
		if (event.type === "permission") {
			setState((prev) => ({
				...prev,
				message: `${event.service}: ${event.status}${
					event.message ? ` (${event.message})` : ""
				}`,
			}));
			return;
		}
		if (event.type === "error") {
			errorsRef.current = [...errorsRef.current, event.message];
			setState((prev) => ({
				...prev,
				status: "error",
				error: event.message,
				message: "Listener helper reported an error.",
			}));
			return;
		}
		filesRef.current = { ...filesRef.current, ...(event.files ?? {}) };
	}, []);

	const startListening = useCallback(() => {
		try {
			const session = prepareListenSession({
				sources: state.sources,
				recordingsDir,
			});
			helperVersionRef.current = undefined;
			filesRef.current = {};
			errorsRef.current = [];
			setState({
				status: "requestingPermission",
				sources: state.sources,
				session,
				outputDir: session.finalDir,
				message: "Starting audio helper…",
			});
			setLeftIndex(0); // select the "start/recording" row
			const handle = startMacOSAudioCapture({
				session,
				helperPath,
				onEvent: onHelperEvent,
			});
			handleRef.current = handle;
		} catch (error) {
			setState((prev) => ({
				...prev,
				status: "error",
				error: helperErrorMessage(error),
				message: "Could not start listener.",
			}));
		}
	}, [helperPath, onHelperEvent, recordingsDir, state.sources, setLeftIndex]);

	const finalize = useCallback(
		async (action: "save" | "discard") => {
			const session = state.session;
			const handle = handleRef.current;
			if (!session) return;
			setState((prev) => ({
				...prev,
				status: "stopping",
				message:
					action === "save"
						? "Stopping and saving recording…"
						: "Stopping and discarding recording…",
			}));
			try {
				await handle?.stop(action);
				if (handle) {
					await waitForAudioHelperExit(
						handle.child,
						action === "discard" ? 5_000 : undefined,
					);
				}
				handleRef.current = null;
				if (action === "discard") {
					discardListenSession(session);
					setState({
						status: "discarded",
						sources: session.sources,
						message: "Recording discarded.",
					});
					return;
				}
				const metadata = buildListenMetadata({
					session,
					files: filesRef.current,
					stoppedAt: new Date(),
					helperPath: handle?.helperPath ?? helperPath,
					helperVersion: helperVersionRef.current,
					errors: errorsRef.current,
				});
				const outputDir = saveListenSession(session, metadata);
				refreshRecordings();
				setState({
					status: "saved",
					sources: session.sources,
					outputDir,
					message: `Recording saved to ${outputDir}`,
				});
			} catch (error) {
				setState((prev) => ({
					...prev,
					status: "error",
					error: helperErrorMessage(error),
					message: "Could not finalize recording.",
				}));
			}
		},
		[helperPath, refreshRecordings, state.session],
	);

	// ---- Input handling ----
	useInput((input, key) => {
		if (confirmAction || editField) return;

		if (isQuitKey(input, key)) {
			if (isRecording) {
				setConfirmAction("quit");
				return;
			}
			exit();
			return;
		}

		// Global shortcuts while recording (work regardless of pane focus)
		if (state.status === "listening" && input === "s") {
			void finalize("save");
			return;
		}
		if (state.status === "listening" && input === "d") {
			setConfirmAction("discard");
			return;
		}

		// Tab switches panes, but when recording the right pane is always active
		if (key.tab && !isRecording) {
			toggleFocus();
			return;
		}

		const activePane = isRecording ? "right" : focusedPane;

		if (activePane === "left") {
			if (isNavigateUp(input, key)) {
				setLeftIndex((prev) => Math.max(0, prev - 1));
				return;
			}
			if (isNavigateDown(input, key)) {
				setLeftIndex((prev) => Math.min(leftItems.length - 1, prev + 1));
				return;
			}
			if (isSelectKey(input, key)) {
				if (isStartSelected && !isRecording) {
					startListening();
				} else if (!isRecording) {
					// Switch focus to right pane to view recording details
					setFocusedPane("right");
					setRightIndex(0);
				}
				return;
			}
			return;
		}

		// Right pane
		if (isRecording) {
			// Navigate between save/discard
			if (isNavigateUp(input, key)) {
				setRightIndex((prev) => Math.max(0, prev - 1));
				return;
			}
			if (isNavigateDown(input, key)) {
				setRightIndex((prev) => Math.min(1, prev + 1));
				return;
			}
			if (isSelectKey(input, key)) {
				if (rightIndex === 0) void finalize("save");
				else setConfirmAction("discard");
				return;
			}
			return;
		}

		// Right pane for saved recording detail
		if (isBackKey(input, key)) {
			setFocusedPane("left");
			return;
		}
		if (isNavigateUp(input, key)) {
			setRightIndex((prev) => Math.max(0, prev - 1));
			return;
		}
		if (isNavigateDown(input, key)) {
			const maxIndex = isStartSelected
				? 1 // mic + system toggles
				: selectedRecording
					? detailRowCount(selectedRecording) - 1
					: 0;
			setRightIndex((prev) => Math.min(maxIndex, prev + 1));
			return;
		}
		if (isSelectKey(input, key) && selectedRecording) {
			const rows = detailRows(selectedRecording);
			const row = rows[rightIndex];
			if (!row) return;
			if (row.kind === "field" && row.field !== "location") {
				setEditField({ field: row.field, recording: selectedRecording });
				return;
			}
			if (row.kind === "action" && row.action === "open") {
				try {
					openListenRecordingInFinder(selectedRecording);
					setState((prev) => ({
						...prev,
						message: `Opened ${selectedRecording.id} in Finder.`,
					}));
				} catch (error) {
					setState((prev) => ({
						...prev,
						status: "error",
						error: helperErrorMessage(error),
						message: "Could not open recording folder.",
					}));
				}
				return;
			}
			if (row.kind === "delete") {
				setConfirmAction("deleteRecording");
			}
			return;
		}
		if (isStartSelected) {
			// Source toggles in idle start view — Enter or Space to toggle
			if (isSelectKey(input, key) || isToggleKey(input, key)) {
				if (rightIndex === 0) {
					setState((prev) => ({
						...prev,
						sources: { ...prev.sources, mic: !prev.sources.mic },
					}));
				} else if (rightIndex === 1) {
					setState((prev) => ({
						...prev,
						sources: { ...prev.sources, system: !prev.sources.system },
					}));
				}
				return;
			}
		}
	});

	// Detail rows for a saved recording
	function detailRows(recording: ListenRecordingSummary) {
		return [
			{
				kind: "field" as const,
				field: "name" as const,
				label: "Name",
				value: recording.metadata.name ?? "",
			},
			{
				kind: "field" as const,
				field: "description" as const,
				label: "Description",
				value: recording.metadata.description ?? "",
				multiline: true,
			},
			{
				kind: "field" as const,
				field: "location" as const,
				label: "Location",
				value: recording.dir,
			},
			{
				kind: "info" as const,
				label: "Duration",
				value: formatDuration(recording.metadata.durationMs) || "N/A",
			},
			{
				kind: "info" as const,
				label: "Date",
				value: formatRecordingDate(
					recording.metadata.startedAt || recording.metadata.createdAt,
				),
			},
			{
				kind: "info" as const,
				label: "Sources",
				value: formatListenSources(recording.metadata.sources),
			},
			{
				kind: "action" as const,
				action: "open" as const,
				label: "Open folder in Finder",
			},
			{
				kind: "delete" as const,
				action: "delete" as const,
				label: "Delete recording",
			},
		];
	}

	function detailRowCount(recording: ListenRecordingSummary): number {
		return detailRows(recording).length;
	}

	// ---- Edit overlay ----
	if (editField) {
		return (
			<FieldEditor
				appTitle="Listen"
				fieldLabel={
					editField.field === "name"
						? "Recording name"
						: "Recording description"
				}
				value={editField.recording.metadata[editField.field] ?? ""}
				multiline={editField.field === "description"}
				placeholder={
					editField.field === "name"
						? "Optional recording name…"
						: "Optional recording description…"
				}
				onSubmit={(value) => {
					const updated = updateListenRecordingMetadata(editField.recording, {
						[editField.field]: value,
					});
					refreshRecordings();
					setState((prev) => ({
						...prev,
						message: `Updated ${updated.id}.`,
					}));
					setEditField(null);
				}}
				onCancel={() => setEditField(null)}
			/>
		);
	}

	// ---- Confirm dialog ----
	if (confirmAction) {
		const recordingForDelete =
			selectedItem?.kind === "recording" ? selectedItem.recording : null;
		return (
			<ConfirmDialog
				title="Listen"
				message={
					confirmAction === "discard"
						? "Discard the current recording?"
						: confirmAction === "quit"
							? "Stop and discard the active recording before quitting?"
							: `Delete recording ${recordingForDelete?.id ?? ""}?`
				}
				onConfirm={() => {
					setConfirmAction(null);
					if (confirmAction === "deleteRecording" && recordingForDelete) {
						deleteListenRecording(recordingForDelete);
						refreshRecordings();
						setState((prev) => ({
							...prev,
							message: `Deleted ${recordingForDelete.id}.`,
						}));
						return;
					}
					void finalize("discard").then(() => {
						if (confirmAction === "quit") exit();
					});
				}}
				onCancel={() => setConfirmAction(null)}
			/>
		);
	}

	// ---- Main two-pane layout ----
	// When recording, the right pane is always the active one regardless of
	// where the user last left the focus.
	const displayFocusedPane = isRecording ? "right" : focusedPane;

	// Build the right pane content
	let rightContent: React.ReactNode;
	if (isRecording) {
		rightContent = (
			<RecordingView
				state={state}
				elapsed={elapsed}
				onSave={() => void finalize("save")}
				onDiscard={() => setConfirmAction("discard")}
				focusIndex={rightIndex}
			/>
		);
	} else if (isStartSelected) {
		rightContent = (
			<IdleStartView
				sources={state.sources}
				focusIndex={rightIndex}
				onToggleMic={() =>
					setState((prev) => ({
						...prev,
						sources: { ...prev.sources, mic: !prev.sources.mic },
					}))
				}
				onToggleSystem={() =>
					setState((prev) => ({
						...prev,
						sources: { ...prev.sources, system: !prev.sources.system },
					}))
				}
			/>
		);
	} else if (selectedRecording) {
		rightContent = (
			<RecordingDetailView
				recording={selectedRecording}
				focusIndex={rightIndex}
				onOpenFinder={() => {
					try {
						openListenRecordingInFinder(selectedRecording);
						setState((prev) => ({
							...prev,
							message: `Opened ${selectedRecording.id} in Finder.`,
						}));
					} catch (error) {
						setState((prev) => ({
							...prev,
							status: "error",
							error: helperErrorMessage(error),
							message: "Could not open recording folder.",
						}));
					}
				}}
				onDelete={() => setConfirmAction("deleteRecording")}
			/>
		);
	} else {
		rightContent = (
			<Box paddingX={1}>
				<Text dimColor>Select an item on the left.</Text>
			</Box>
		);
	}

	const footerText = isRecording
		? "s stop & save · d stop & discard · q close"
		: "↑↓ navigate · Enter select · Tab switch pane · q close";

	const leftPane = (
		<>
			{leftItems.map((item, i) => {
				const isSelected = i === leftIndex && displayFocusedPane === "left";
				if (item.kind === "start") {
					const label = isRecording ? "Recording…" : "Start new recording";
					return (
						<SelectableTextRow key="start" selected={isSelected}>
							<Text bold color={isRecording ? "red" : "green"}>
								{UI_GLYPHS.action} {label}
							</Text>
						</SelectableTextRow>
					);
				}
				const rec = item.recording;
				return (
					<SelectableTextRow key={rec.id} selected={isSelected}>
						<Text>
							{UI_GLYPHS.section} {recordingLabel(rec)}
						</Text>
					</SelectableTextRow>
				);
			})}
			{recordings.length === 0 && !isRecording ? (
				<Box paddingX={1}>
					<Text dimColor>No recordings yet.</Text>
				</Box>
			) : null}
		</>
	);

	return (
		<TwoPaneView
			title="Listen"
			subheader={
				isRecording ? (
					<Text color="red" bold>
						{RECORDING_DOT_FRAMES[dotFrame]} Recording — {elapsed}
					</Text>
				) : undefined
			}
			statusBar={<Text dimColor>{footerText}</Text>}
			focusedPane={displayFocusedPane}
			left={leftPane}
			right={rightContent}
			status={
				<>
					{state.status === "saved" && state.message ? (
						<Box paddingX={1} marginTop={1}>
							<Text color="green">
								{UI_GLYPHS.success} {state.message}
							</Text>
						</Box>
					) : null}
					{state.status === "discarded" && state.message ? (
						<Box paddingX={1} marginTop={1}>
							<Text dimColor>{state.message}</Text>
						</Box>
					) : null}
				</>
			}
		/>
	);
}

export function runListenUI(options: ListenAppOptions): void {
	const profile = detectTerminalProfile();
	render(<ListenApp {...options} />, {
		kittyKeyboard: {
			mode: resolveKittyKeyboardMode(profile),
			flags: ["disambiguateEscapeCodes"],
		},
	});
}
