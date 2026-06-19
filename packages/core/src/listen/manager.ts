import {
	type AudioCaptureHandle,
	type AudioHelperEvent,
	startMacOSAudioCapture,
} from "./macos/audio-capture";
import { readListenTranscript } from "./recordings";
import {
	buildListenMetadata,
	discardListenSession,
	prepareListenSession,
	remapListenFilesToFinalDir,
	saveListenSession,
	writeListenMetadata,
} from "./session-controller";
import { transcribeWithPlugin } from "./transcription-plugin";
import {
	DEFAULT_LISTEN_SOURCES,
	type ListenRecordingFiles,
	type ListenSession,
	type ListenSourceSelection,
} from "./types";

export type ListenManagerStatus =
	| "idle"
	| "starting"
	| "recording"
	| "stopping"
	| "error";

export interface ListenManagerState {
	readonly status: ListenManagerStatus;
	readonly session?: {
		readonly id: string;
		readonly startedAt: string;
		readonly sources: ListenSourceSelection;
	};
	readonly outputDir?: string;
	readonly message?: string;
	readonly error?: string;
}

export interface ListenStartResult extends ListenManagerState {}

export interface ListenStopResult extends ListenManagerState {
	readonly outputDir?: string;
	readonly transcript?: string;
	readonly transcriptionError?: string;
}

export interface ListenManagerDeps {
	readonly startCapture?: (options: {
		readonly session: ListenSession;
		readonly helperPath?: string;
		readonly onEvent?: (event: AudioHelperEvent) => void;
	}) => AudioCaptureHandle;
	readonly transcribe?: (options: {
		readonly input: string;
		readonly outDir: string;
		readonly onStatus?: (message: string) => void;
	}) => Promise<ListenRecordingFiles>;
}

export interface ListenStartOptions {
	readonly sources?: ListenSourceSelection;
	readonly helperPath?: string;
	readonly recordingsDir?: string;
}

export interface ListenStopOptions {
	readonly action?: "save" | "discard";
}

function stateForSession(
	status: ListenManagerStatus,
	session: ListenSession,
	message?: string,
	error?: string,
): ListenManagerState {
	return {
		status,
		session: {
			id: session.id,
			startedAt: session.startedAt,
			sources: session.sources,
		},
		outputDir: session.finalDir,
		...(message ? { message } : {}),
		...(error ? { error } : {}),
	};
}

export class ListenManager {
	private statusValue: ListenManagerStatus = "idle";
	private session: ListenSession | null = null;
	private handle: AudioCaptureHandle | null = null;
	private helperVersion: string | undefined;
	private files: ListenRecordingFiles = {};
	private errors: string[] = [];
	private message = "Ready to record audio.";
	private error: string | undefined;

	private readonly startCapture: NonNullable<ListenManagerDeps["startCapture"]>;
	private readonly transcribe: NonNullable<ListenManagerDeps["transcribe"]>;

	constructor(deps: ListenManagerDeps = {}) {
		this.startCapture = deps.startCapture ?? startMacOSAudioCapture;
		this.transcribe = deps.transcribe ?? transcribeWithPlugin;
	}

	status(): ListenManagerState {
		if (this.session) {
			return stateForSession(
				this.statusValue,
				this.session,
				this.message,
				this.error,
			);
		}
		return {
			status: this.statusValue,
			message: this.message,
			...(this.error ? { error: this.error } : {}),
		};
	}

	start(options: ListenStartOptions = {}): ListenStartResult {
		if (this.session || this.handle) {
			throw new Error("Already recording.");
		}
		const session = prepareListenSession({
			sources: options.sources ?? DEFAULT_LISTEN_SOURCES,
			recordingsDir: options.recordingsDir,
		});
		this.session = session;
		this.statusValue = "starting";
		this.message = "Starting recording...";
		this.error = undefined;
		this.helperVersion = undefined;
		this.files = {};
		this.errors = [];

		try {
			this.handle = this.startCapture({
				session,
				helperPath: options.helperPath,
				onEvent: (event) => this.handleEvent(event),
			});
			return this.status();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.statusValue = "error";
			this.message = "Could not start recording.";
			this.error = message;
			this.session = null;
			this.handle = null;
			throw error;
		}
	}

	async stop(options: ListenStopOptions = {}): Promise<ListenStopResult> {
		const action = options.action ?? "save";
		const session = this.session;
		const handle = this.handle;
		if (!session || !handle) {
			throw new Error("No active recording.");
		}

		this.statusValue = "stopping";
		this.message =
			action === "save"
				? "Stopping and saving recording..."
				: "Stopping and discarding recording...";
		this.error = undefined;

		try {
			await handle.stop(action);
			this.handle = null;
			this.session = null;

			if (action === "discard") {
				discardListenSession(session);
				this.statusValue = "idle";
				this.message = "Recording discarded.";
				return { status: "idle", message: this.message };
			}

			const savedFiles = remapListenFilesToFinalDir(session, this.files);
			const metadata = buildListenMetadata({
				session,
				files: savedFiles,
				stoppedAt: new Date(),
				helperPath: handle.helperPath,
				helperVersion: this.helperVersion,
				errors: this.errors,
			});
			const outputDir = saveListenSession(session, metadata);
			let transcript = readTranscript(outputDir);
			let transcriptionError: string | undefined;

			if (!transcript && savedFiles.combined) {
				try {
					this.message = "Transcribing recording...";
					const transcriptFiles = await this.transcribe({
						input: savedFiles.combined,
						outDir: outputDir,
						onStatus: (message) => {
							this.message = message;
						},
					});
					writeListenMetadata(outputDir, {
						...metadata,
						files: { ...savedFiles, ...transcriptFiles },
					});
					transcript = readTranscript(outputDir);
				} catch (error) {
					transcriptionError =
						error instanceof Error ? error.message : String(error);
					this.errors = [...this.errors, transcriptionError];
					writeListenMetadata(
						outputDir,
						buildListenMetadata({
							session,
							files: savedFiles,
							stoppedAt: new Date(),
							helperPath: handle.helperPath,
							helperVersion: this.helperVersion,
							errors: this.errors,
						}),
					);
				}
			}

			this.statusValue = "idle";
			this.message = "Recording saved.";
			return {
				status: "idle",
				message: this.message,
				outputDir,
				...(transcript ? { transcript } : {}),
				...(transcriptionError ? { transcriptionError } : {}),
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.handle = null;
			this.session = null;
			this.statusValue = "error";
			this.message = "Could not finalize recording.";
			this.error = message;
			throw error;
		}
	}

	private handleEvent(event: AudioHelperEvent): void {
		if (event.type === "ready") {
			this.statusValue = "recording";
			this.message = "Recording.";
			this.helperVersion = event.helperVersion;
		} else if (event.type === "status") {
			this.message = event.message;
		} else if (event.type === "permission") {
			this.message = `${event.service}: ${event.status}${
				event.message ? ` (${event.message})` : ""
			}`;
		} else if (event.type === "error") {
			this.statusValue = "error";
			this.message = "Listener helper reported an error.";
			this.error = event.message;
			this.errors = [...this.errors, event.message];
		}
		if ("files" in event && event.files) {
			this.files = { ...this.files, ...event.files };
		}
	}
}

function readTranscript(outputDir: string): string | undefined {
	const result = readListenTranscript(outputDir);
	return result.ok ? result.text : undefined;
}

export const listenManager = new ListenManager();
