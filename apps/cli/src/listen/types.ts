export type {
	ListenRecordingFiles,
	ListenRecordingMetadata,
	ListenSource,
	ListenSourceSelection,
} from "@toby/core/listen/types";
export {
	DEFAULT_LISTEN_SOURCES,
	formatListenSources,
	selectedListenSources,
} from "@toby/core/listen/types";

type ListenStatus =
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
	readonly sources: import("@toby/core/listen/types").ListenSourceSelection;
}

export interface ListenState {
	readonly status: ListenStatus;
	readonly sources: import("@toby/core/listen/types").ListenSourceSelection;
	readonly session?: ListenSession;
	readonly outputDir?: string;
	readonly message?: string;
	readonly error?: string;
}
