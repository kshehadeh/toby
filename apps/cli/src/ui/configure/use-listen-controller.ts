import { transcribeWithPlugin } from "@toby/core/listen/transcription-plugin";
import { useCallback, useEffect, useRef, useState } from "react";
import { applyTranscriptFilesToMetadata } from "../../commands/listen";
import {
	type AudioCaptureHandle,
	type AudioHelperEvent,
	ListenCaptureError,
	startMacOSAudioCapture,
} from "../../listen/macos/audio-capture";
import {
	buildListenMetadata,
	createInitialListenState,
	deleteListenRecording,
	discardListenSession,
	prepareListenSession,
	remapListenFilesToFinalDir,
	saveListenSession,
	updateListenRecordingMetadata,
	writeListenMetadata,
} from "../../listen/session-controller";
import type { ListenRecordingSummary } from "../../listen/session-controller";
import type {
	ListenRecordingFiles,
	ListenSourceSelection,
	ListenState,
} from "../../listen/types";
import { formatListenElapsed } from "./listen-panes";
import { seedListenRecordingValues } from "./listen-values";

export interface ListenControllerOptions {
	readonly sources: ListenSourceSelection;
	readonly recordingsDir?: string;
}

export type ListenSectionOptions = ListenControllerOptions;

export type ListenConfirmAction = "discard" | "quit" | "deleteRecording";

function helperErrorMessage(error: unknown): string {
	if (error instanceof ListenCaptureError) return error.message;
	return error instanceof Error ? error.message : String(error);
}

export function useListenController(
	options: ListenControllerOptions,
	onRecordingsChanged: (values: Record<string, string>) => void,
	values: Record<string, string>,
) {
	const { recordingsDir } = options;
	const [state, setState] = useState<ListenState>(() =>
		createInitialListenState(options.sources),
	);
	const [listenConfirm, setListenConfirm] =
		useState<ListenConfirmAction | null>(null);
	const [pendingDeleteRecording, setPendingDeleteRecording] =
		useState<ListenRecordingSummary | null>(null);
	const [elapsed, setElapsed] = useState("0:00");
	const [listenStatusMessage, setListenStatusMessage] = useState<
		string | undefined
	>(undefined);

	const handleRef = useRef<AudioCaptureHandle | null>(null);
	const helperVersionRef = useRef<string | undefined>(undefined);
	const filesRef = useRef<ListenRecordingFiles>({});
	const errorsRef = useRef<string[]>([]);

	const isRecording =
		state.status === "listening" ||
		state.status === "requestingPermission" ||
		state.status === "stopping";

	const syncRecordings = useCallback(() => {
		const nextValues = { ...values };
		seedListenRecordingValues(nextValues, recordingsDir);
		onRecordingsChanged(nextValues);
	}, [onRecordingsChanged, recordingsDir, values]);

	useEffect(() => {
		return () => {
			handleRef.current?.dispose();
		};
	}, []);

	useEffect(() => {
		if (state.status !== "listening" || !state.session) {
			setElapsed(formatListenElapsed(state.session));
			return;
		}
		const interval = setInterval(() => {
			setElapsed(formatListenElapsed(state.session));
		}, 1000);
		return () => clearInterval(interval);
	}, [state.session, state.status]);

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
			setListenStatusMessage(undefined);
			setState({
				status: "requestingPermission",
				sources: state.sources,
				session,
				outputDir: session.finalDir,
				message: "Starting recording…",
			});
			const handle = startMacOSAudioCapture({
				session,
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
	}, [onHelperEvent, recordingsDir, state.sources]);

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
				const savedFiles = remapListenFilesToFinalDir(
					session,
					filesRef.current,
				);
				const metadata = buildListenMetadata({
					session,
					files: savedFiles,
					stoppedAt: new Date(),
					helperPath: handle?.helperPath,
					helperVersion: helperVersionRef.current,
					errors: errorsRef.current,
				});
				const outputDir = saveListenSession(session, metadata);
				try {
					if (savedFiles.combined) {
						setListenStatusMessage("Transcribing recording…");
						const transcriptFiles = await transcribeWithPlugin({
							input: savedFiles.combined,
							outDir: outputDir,
							onStatus: (message) => setListenStatusMessage(message),
						});
						writeListenMetadata(
							outputDir,
							applyTranscriptFilesToMetadata(metadata, {
								...savedFiles,
								...transcriptFiles,
							}),
						);
					}
				} catch (error) {
					const message = helperErrorMessage(error);
					errorsRef.current = [...errorsRef.current, message];
					writeListenMetadata(
						outputDir,
						buildListenMetadata({
							session,
							files: savedFiles,
							stoppedAt: new Date(),
							helperPath: handle?.helperPath,
							helperVersion: helperVersionRef.current,
							errors: errorsRef.current,
						}),
					);
				}
				syncRecordings();
				setState({
					status: "saved",
					sources: session.sources,
					outputDir,
					message: `Recording saved to ${outputDir}`,
				});
				setListenStatusMessage(`Recording saved to ${outputDir}`);
			} catch (error) {
				setState((prev) => ({
					...prev,
					status: "error",
					error: helperErrorMessage(error),
					message: "Could not finalize recording.",
				}));
			}
		},
		[state.session, syncRecordings],
	);

	const toggleMic = useCallback(() => {
		setState((prev) => ({
			...prev,
			sources: { ...prev.sources, mic: !prev.sources.mic },
		}));
	}, []);

	const toggleSystem = useCallback(() => {
		setState((prev) => ({
			...prev,
			sources: { ...prev.sources, system: !prev.sources.system },
		}));
	}, []);

	const requestDeleteRecording = useCallback(
		(recording: ListenRecordingSummary) => {
			setPendingDeleteRecording(recording);
			setListenConfirm("deleteRecording");
		},
		[],
	);

	const handleListenConfirm = useCallback(
		(onQuit?: () => void) => {
			const action = listenConfirm;
			setListenConfirm(null);
			if (action === "deleteRecording" && pendingDeleteRecording) {
				deleteListenRecording(pendingDeleteRecording);
				setPendingDeleteRecording(null);
				syncRecordings();
				setListenStatusMessage(`Deleted ${pendingDeleteRecording.id}.`);
				return;
			}
			setPendingDeleteRecording(null);
			void finalize("discard").then(() => {
				if (action === "quit") onQuit?.();
			});
		},
		[finalize, listenConfirm, pendingDeleteRecording, syncRecordings],
	);

	return {
		state,
		elapsed,
		isRecording,
		listenConfirm,
		setListenConfirm,
		pendingDeleteRecording,
		listenStatusMessage,
		setListenStatusMessage,
		startListening,
		finalize,
		toggleMic,
		toggleSystem,
		handleListenConfirm,
		requestDeleteRecording,
		syncRecordings,
	};
}
