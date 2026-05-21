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
	InfoRow,
	NavigatorRow,
	SelectableTextRow,
	StatusIcon,
	UI_GLYPHS,
	ViewFrame,
	detectTerminalProfile,
	isBackKey,
	isNavigateDown,
	isNavigateUp,
	isQuitKey,
	isSelectKey,
	resolveKittyKeyboardMode,
} from "../shared";

export interface ListenAppOptions {
	readonly sources: ListenSourceSelection;
	readonly helperPath?: string;
	readonly recordingsDir?: string;
}

type ConfirmAction = "discard" | "quit" | "deleteRecording";
type EditRecordingField = "name" | "description";
type ListenAction = "start" | "save" | "discard" | "toggleMic" | "toggleSystem";
type ListenScreen = "main" | "recordingDetail";
type ListenRow =
	| { readonly kind: "action"; readonly action: ListenAction }
	| { readonly kind: "recording"; readonly recording: ListenRecordingSummary };
type RecordingDetailRow =
	| {
			readonly kind: "field";
			readonly field: EditRecordingField | "location";
			readonly label: string;
			readonly value: string;
			readonly multiline?: boolean;
	  }
	| {
			readonly kind: "action";
			readonly action: "open";
			readonly label: string;
	  }
	| {
			readonly kind: "delete";
			readonly action: "delete";
			readonly label: string;
	  };

const MAX_RECORDINGS_VISIBLE = 8;

function listenStatusIcon(status: ListenState["status"]) {
	if (status === "error") return <StatusIcon status="error" />;
	if (status === "saved" || status === "discarded") {
		return <StatusIcon status="success" />;
	}
	if (
		status === "requestingPermission" ||
		status === "listening" ||
		status === "stopping"
	) {
		return <StatusIcon status="running" />;
	}
	return <StatusIcon status="pending" />;
}

function formatElapsed(session: ListenSession | undefined): string {
	if (!session) return "0s";
	const elapsedMs = Math.max(0, Date.now() - Date.parse(session.startedAt));
	const seconds = Math.floor(elapsedMs / 1000);
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function listenFooter(status: ListenState["status"]): string {
	if (status === "listening") {
		return "s stop and save · d discard · q close";
	}
	if (status === "requestingPermission" || status === "stopping") {
		return "Waiting for listener…";
	}
	return "↑↓ navigate · Enter select · q close";
}

function helperErrorMessage(error: unknown): string {
	if (error instanceof ListenCaptureError) {
		return error.message;
	}
	return error instanceof Error ? error.message : String(error);
}

function formatRecordingDate(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString();
}

function formatDuration(ms: number | undefined): string {
	if (ms === undefined) return "";
	const seconds = Math.round(ms / 1000);
	const mins = Math.floor(seconds / 60);
	const secs = seconds % 60;
	return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function actionLabel(
	action: ListenAction,
	sources: ListenSourceSelection,
): string {
	if (action === "start") return "Start listening";
	if (action === "save") return "Stop and save";
	if (action === "discard") return "Stop and discard";
	if (action === "toggleMic") {
		return `${sources.mic ? UI_GLYPHS.checkboxOn : UI_GLYPHS.checkboxOff} Microphone`;
	}
	return `${sources.system ? UI_GLYPHS.checkboxOn : UI_GLYPHS.checkboxOff} System audio`;
}

function recordingLabel(recording: ListenRecordingSummary): string {
	const duration = formatDuration(recording.metadata.durationMs);
	const date = formatRecordingDate(
		recording.metadata.startedAt || recording.metadata.createdAt,
	);
	const title = recording.metadata.name?.trim() || date;
	const fileBits = [
		recording.metadata.files.combined ? "combined" : null,
		recording.metadata.files.mic ? "mic" : null,
		recording.metadata.files.system ? "system" : null,
	].filter(Boolean);
	return `${title}${duration ? ` · ${duration}` : ""} · ${fileBits.join("/")}`;
}

function visibleRows(params: {
	readonly rows: readonly ListenRow[];
	readonly selectedIndex: number;
}): Array<readonly [ListenRow, number]> {
	const actionRows = params.rows
		.map((row, index) => [row, index] as const)
		.filter(([row]) => row.kind === "action");
	const recordingRows = params.rows
		.map((row, index) => [row, index] as const)
		.filter(([row]) => row.kind === "recording");
	if (recordingRows.length <= MAX_RECORDINGS_VISIBLE) {
		return [...actionRows, ...recordingRows];
	}
	const selectedRecordingOffset = recordingRows.findIndex(
		([, index]) => index === params.selectedIndex,
	);
	const focusedOffset =
		selectedRecordingOffset === -1 ? 0 : selectedRecordingOffset;
	const half = Math.floor(MAX_RECORDINGS_VISIBLE / 2);
	const start = Math.min(
		Math.max(0, focusedOffset - half),
		Math.max(0, recordingRows.length - MAX_RECORDINGS_VISIBLE),
	);
	return [
		...actionRows,
		...recordingRows.slice(start, start + MAX_RECORDINGS_VISIBLE),
	];
}

function renderRows(params: {
	readonly rows: readonly ListenRow[];
	readonly selectedIndex: number;
	readonly sources: ListenSourceSelection;
}) {
	const rowsToRender = visibleRows(params);
	const recordingCount = params.rows.filter(
		(row) => row.kind === "recording",
	).length;
	const hasRecordings = recordingCount > 0;
	return (
		<>
			{rowsToRender.map(([row, index]) => {
				if (row.kind === "action") {
					return (
						<ActionRow
							key={`action-${row.action}`}
							label={actionLabel(row.action, params.sources)}
							kind={row.action === "discard" ? "delete" : "action"}
							selected={index === params.selectedIndex}
						/>
					);
				}
				return (
					<SelectableTextRow
						key={row.recording.id}
						selected={index === params.selectedIndex}
					>
						{UI_GLYPHS.section} {recordingLabel(row.recording)}{" "}
						{row.recording.metadata.description ? (
							<Text dimColor>{row.recording.metadata.description}</Text>
						) : null}
					</SelectableTextRow>
				);
			})}
			{hasRecordings ? (
				<Box paddingX={1} marginTop={1}>
					<Text dimColor>
						Enter details · showing{" "}
						{Math.min(MAX_RECORDINGS_VISIBLE, recordingCount)} of{" "}
						{recordingCount}
					</Text>
				</Box>
			) : (
				<Box paddingX={1} marginTop={1}>
					<Text dimColor>No recordings saved yet.</Text>
				</Box>
			)}
		</>
	);
}

export function ListenApp({
	sources,
	helperPath,
	recordingsDir,
}: ListenAppOptions) {
	const { exit } = useApp();
	const [state, setState] = useState<ListenState>(() =>
		createInitialListenState(sources),
	);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [screen, setScreen] = useState<ListenScreen>("main");
	const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(
		null,
	);
	const [selectedDetailIndex, setSelectedDetailIndex] = useState(0);
	const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(
		null,
	);
	const [editField, setEditField] = useState<{
		readonly field: EditRecordingField;
		readonly recording: ListenRecordingSummary;
	} | null>(null);
	const [elapsed, setElapsed] = useState("0s");
	const [recordings, setRecordings] = useState<ListenRecordingSummary[]>(() =>
		listListenRecordings(recordingsDir),
	);
	const handleRef = useRef<AudioCaptureHandle | null>(null);
	const helperVersionRef = useRef<string | undefined>(undefined);
	const filesRef = useRef<ListenRecordingFiles>({});
	const errorsRef = useRef<string[]>([]);

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

	useEffect(() => {
		return () => {
			handleRef.current?.dispose();
		};
	}, []);

	const refreshRecordings = useCallback(() => {
		setRecordings(listListenRecordings(recordingsDir));
	}, [recordingsDir]);

	const selectedRecording = useMemo(
		() =>
			selectedRecordingId
				? (recordings.find(
						(recording) => recording.id === selectedRecordingId,
					) ?? null)
				: null,
		[recordings, selectedRecordingId],
	);

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
	}, [helperPath, onHelperEvent, recordingsDir, state.sources]);

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

	const actionRows = useMemo((): ListenAction[] => {
		if (state.status === "listening") return ["save", "discard"];
		return ["toggleMic", "toggleSystem", "start"];
	}, [state.status]);

	const rows = useMemo((): ListenRow[] => {
		const actions: ListenRow[] = actionRows.map((action) => ({
			kind: "action" as const,
			action,
		}));
		if (
			state.status === "listening" ||
			state.status === "requestingPermission"
		) {
			return actions;
		}
		return [
			...actions,
			...recordings.map((recording) => ({
				kind: "recording" as const,
				recording,
			})),
		];
	}, [actionRows, recordings, state.status]);

	useEffect(() => {
		setSelectedIndex((prev) => Math.min(prev, Math.max(0, rows.length - 1)));
	}, [rows.length]);

	useInput((input, key) => {
		if (confirmAction) return;
		if (screen === "recordingDetail") return;
		if (isQuitKey(input, key)) {
			if (state.status === "listening") {
				setConfirmAction("quit");
				return;
			}
			exit();
			return;
		}
		if (isNavigateUp(input, key)) {
			setSelectedIndex((prev) => Math.max(0, prev - 1));
			return;
		}
		if (isNavigateDown(input, key)) {
			setSelectedIndex((prev) => Math.min(rows.length - 1, prev + 1));
			return;
		}
		if (state.status === "listening" && input === "s") {
			void finalize("save");
			return;
		}
		if (state.status === "listening" && input === "d") {
			setConfirmAction("discard");
			return;
		}
		const selectedRow = rows[selectedIndex] ?? rows[0];
		if (isSelectKey(input, key)) {
			if (selectedRow?.kind === "recording") {
				setSelectedRecordingId(selectedRow.recording.id);
				setSelectedDetailIndex(0);
				setScreen("recordingDetail");
				return;
			}
			const selected = selectedRow?.action;
			if (selected === "start") startListening();
			if (selected === "save") void finalize("save");
			if (selected === "discard") setConfirmAction("discard");
			if (selected === "toggleMic") {
				setState((prev) => ({
					...prev,
					sources: { ...prev.sources, mic: !prev.sources.mic },
				}));
			}
			if (selected === "toggleSystem") {
				setState((prev) => ({
					...prev,
					sources: { ...prev.sources, system: !prev.sources.system },
				}));
			}
		}
	});

	const detailRows = useMemo((): RecordingDetailRow[] => {
		if (!selectedRecording) return [];
		return [
			{
				kind: "field",
				field: "name",
				label: "Name",
				value: selectedRecording.metadata.name ?? "",
			},
			{
				kind: "field",
				field: "description",
				label: "Description",
				value: selectedRecording.metadata.description ?? "",
				multiline: true,
			},
			{
				kind: "field",
				field: "location",
				label: "Location",
				value: selectedRecording.dir,
			},
			{
				kind: "action",
				action: "open",
				label: "Open folder in Finder",
			},
			{
				kind: "delete",
				action: "delete",
				label: "Delete recording",
			},
		];
	}, [selectedRecording]);

	useEffect(() => {
		setSelectedDetailIndex((prev) =>
			Math.min(prev, Math.max(0, detailRows.length - 1)),
		);
	}, [detailRows.length]);

	useInput((input, key) => {
		if (confirmAction || editField || screen !== "recordingDetail") return;
		if (isQuitKey(input, key)) {
			exit();
			return;
		}
		if (isBackKey(input, key)) {
			setScreen("main");
			setSelectedRecordingId(null);
			return;
		}
		if (isNavigateUp(input, key)) {
			setSelectedDetailIndex((prev) => Math.max(0, prev - 1));
			return;
		}
		if (isNavigateDown(input, key)) {
			setSelectedDetailIndex((prev) =>
				Math.min(detailRows.length - 1, prev + 1),
			);
			return;
		}
		if (!isSelectKey(input, key) || !selectedRecording) return;
		const row = detailRows[selectedDetailIndex];
		if (!row) return;
		if (row.kind === "field" && row.field !== "location") {
			setEditField({ field: row.field, recording: selectedRecording });
			return;
		}
		if (row.kind === "action") {
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
	});

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

	if (confirmAction) {
		const recordingForDelete =
			screen === "recordingDetail"
				? selectedRecording
				: (() => {
						const selectedRow = rows[selectedIndex] ?? rows[0];
						return selectedRow?.kind === "recording"
							? selectedRow.recording
							: null;
					})();
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
						setScreen("main");
						setSelectedRecordingId(null);
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

	if (screen === "recordingDetail" && selectedRecording) {
		return (
			<ViewFrame
				title="Listen"
				subheader={
					<Box flexDirection="column" alignItems="center">
						<Text bold color={ACCENT}>
							Listen &gt; Recording
						</Text>
						<Text dimColor>
							{selectedRecording.metadata.name || selectedRecording.id}
						</Text>
					</Box>
				}
				footer={
					<Text dimColor>
						↑↓ navigate · Enter edit/select · b/Backspace back · q close
					</Text>
				}
			>
				{detailRows.map((row, index) => {
					const selected = index === selectedDetailIndex;
					if (row.kind === "field") {
						return (
							<NavigatorRow
								key={row.field}
								label={row.label}
								kind="value"
								selected={selected}
								currentValue={row.value}
								multiline={row.multiline}
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
			</ViewFrame>
		);
	}

	return (
		<ViewFrame
			title="Listen"
			subheader={
				<Box flexDirection="column" alignItems="center">
					<Text bold color={ACCENT}>
						Listen
					</Text>
					<Text dimColor>{formatListenSources(state.sources)}</Text>
				</Box>
			}
			footer={<Text dimColor>{listenFooter(state.status)}</Text>}
		>
			<Box paddingX={1} marginBottom={1}>
				<Text>
					{listenStatusIcon(state.status)} <Text bold>{state.status}</Text>{" "}
					<Text dimColor>{state.message ?? ""}</Text>
				</Text>
			</Box>
			<InfoRow
				label="Elapsed"
				value={elapsed}
				selected={false}
				hint={state.status === "listening" ? " active" : undefined}
			/>
			<InfoRow
				label="Output"
				value={state.outputDir ?? resolveListenRecordingsDir(recordingsDir)}
				selected={false}
			/>
			{state.error ? (
				<Box paddingX={1} marginTop={1}>
					<Text color="red" wrap="wrap">
						{state.error}
					</Text>
				</Box>
			) : null}
			<Box marginTop={1} flexDirection="column">
				{renderRows({
					rows,
					selectedIndex,
					sources: state.sources,
				})}
			</Box>
			<Box paddingX={1} marginTop={1}>
				<Text dimColor>
					{UI_GLYPHS.pending} Transcription is not enabled yet; recordings are
					saved for later processing.
				</Text>
			</Box>
		</ViewFrame>
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
