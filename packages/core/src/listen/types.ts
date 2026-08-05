import type { TranscriptPayload } from "./transcript-types";

export type ListenSource = "mic" | "system";

export interface ListenSourceSelection {
	readonly mic: boolean;
	readonly system: boolean;
}

export interface ListenRecordingFiles {
	readonly mic?: string;
	readonly system?: string;
	readonly combined?: string;
	readonly transcript?: string;
	readonly transcriptJson?: string;
	readonly summary?: string;
}

export interface ListenRecordingSummaryMeta {
	readonly createdAt: string;
	readonly personaName?: string;
}

export interface ListenRecordingMetadata {
	readonly id: string;
	readonly name?: string;
	readonly description?: string;
	readonly createdAt: string;
	readonly startedAt: string;
	readonly stoppedAt?: string;
	readonly durationMs?: number;
	readonly sources: ListenSourceSelection;
	readonly files: ListenRecordingFiles;
	readonly platform: NodeJS.Platform;
	readonly osVersion?: string;
	readonly helper?: {
		readonly path?: string;
		readonly version?: string;
	};
	readonly errors?: string[];
	readonly chatSessionId?: string;
	/** Metadata about a persisted AI summary (text lives in files.summary). */
	readonly summary?: ListenRecordingSummaryMeta;
	/**
	 * Diagnostics from dual-source combine. Written by Toby.app when exporting
	 * combined.m4a (e.g. dual-mono L=mic,R=system).
	 */
	readonly combine?: {
		readonly mode?: string;
		readonly layout?: string;
		readonly sampleRate?: number;
		readonly sampleCount?: number;
		readonly source?: string;
		readonly fallbackError?: string;
		/** @deprecated older AEC sum path */
		readonly aecApplied?: boolean;
		readonly lagMs?: number;
		readonly correlation?: number;
		readonly aecGain?: number;
		readonly micGain?: number;
		readonly systemGain?: number;
		readonly peak?: number;
	};
}

export interface ListenTranscriptionResponse {
	readonly id: string;
	readonly dir: string;
	readonly metadata: ListenRecordingMetadata;
	readonly hasAudio: boolean;
	readonly audioPath?: string;
	readonly hasTranscript: boolean;
	readonly transcript?: string;
	readonly transcriptError?: string;
	readonly segments?: TranscriptPayload["segments"];
	readonly warnings?: readonly string[];
	readonly hasSummary?: boolean;
	readonly summary?: string;
	readonly summaryMeta?: ListenRecordingSummaryMeta;
}

export const DEFAULT_LISTEN_SOURCES: ListenSourceSelection = {
	mic: true,
	system: true,
};

export type ListenStatus =
	| "idle"
	| "requestingPermission"
	| "listening"
	| "stopping"
	| "saved"
	| "discarded"
	| "error";

export interface ListenSession {
	readonly id: string;
	readonly startedAt: string;
	readonly tempDir: string;
	readonly finalDir: string;
	readonly sources: ListenSourceSelection;
}

export interface ListenState {
	readonly status: ListenStatus;
	readonly sources: ListenSourceSelection;
	readonly session?: ListenSession;
	readonly outputDir?: string;
	readonly message?: string;
	readonly error?: string;
}

export function selectedListenSources(
	sources: ListenSourceSelection,
): ListenSource[] {
	const out: ListenSource[] = [];
	if (sources.mic) out.push("mic");
	if (sources.system) out.push("system");
	return out;
}

export function formatListenSources(sources: ListenSourceSelection): string {
	const selected = selectedListenSources(sources);
	if (selected.length === 0) return "(none)";
	return selected
		.map((source) => (source === "mic" ? "Microphone" : "System audio"))
		.join(" + ");
}
