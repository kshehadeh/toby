export type ListenSource = "mic" | "system";

export interface ListenSourceSelection {
	readonly mic: boolean;
	readonly system: boolean;
}

type ListenStatus =
	| "idle"
	| "requestingPermission"
	| "listening"
	| "stopping"
	| "saved"
	| "discarded"
	| "error";

export interface ListenRecordingFiles {
	readonly mic?: string;
	readonly system?: string;
	readonly combined?: string;
	readonly transcript?: string;
	readonly transcriptJson?: string;
}

export interface ListenSession {
	readonly id: string;
	readonly startedAt: string;
	readonly tempDir: string;
	readonly finalDir: string;
	readonly sources: ListenSourceSelection;
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
}

export interface ListenState {
	readonly status: ListenStatus;
	readonly sources: ListenSourceSelection;
	readonly session?: ListenSession;
	readonly outputDir?: string;
	readonly message?: string;
	readonly error?: string;
}

export const DEFAULT_LISTEN_SOURCES: ListenSourceSelection = {
	mic: true,
	system: true,
};

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
