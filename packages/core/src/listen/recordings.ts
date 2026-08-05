import fs from "node:fs";
import path from "node:path";
import { resolveTobyDir } from "../config/index";
import type { TranscriptPayload } from "./transcript-types";
import type {
	ListenRecordingMetadata,
	ListenRecordingSummaryMeta,
} from "./types";

const LISTEN_DIR = "listen";
const RECORDINGS_DIR = "recordings";
const TRANSCRIPT_TXT = "transcript.txt";
const TRANSCRIPT_JSON = "transcript.json";
const SUMMARY_MD = "summary.md";
const COMBINED_M4A = "combined.m4a";
const MIC_WAV = "mic.wav";
const SYSTEM_WAV = "system.wav";

function getListenDir(baseDir = resolveTobyDir()): string {
	return path.join(baseDir, LISTEN_DIR);
}

function getListenRecordingsDir(baseDir = resolveTobyDir()): string {
	return path.join(getListenDir(baseDir), RECORDINGS_DIR);
}

export function resolveListenRecordingsDir(recordingsDir?: string): string {
	return recordingsDir?.trim() || getListenRecordingsDir();
}

export function metadataPath(dir: string): string {
	return path.join(dir, "metadata.json");
}

export interface ListenRecordingSummary {
	readonly id: string;
	readonly dir: string;
	readonly metadata: ListenRecordingMetadata;
}

function readRecordingSummary(dir: string): ListenRecordingSummary | null {
	const file = metadataPath(dir);
	if (!fs.existsSync(file)) return null;
	try {
		const raw = fs.readFileSync(file, "utf8");
		const metadata = JSON.parse(raw) as ListenRecordingMetadata;
		return {
			id: metadata.id || path.basename(dir),
			dir,
			metadata,
		};
	} catch {
		return null;
	}
}

export function listListenRecordings(
	recordingsDir?: string,
): ListenRecordingSummary[] {
	const root = resolveListenRecordingsDir(recordingsDir);
	if (!fs.existsSync(root)) return [];
	return fs
		.readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && entry.name !== ".tmp")
		.map((entry) => readRecordingSummary(path.join(root, entry.name)))
		.filter((entry): entry is ListenRecordingSummary => entry !== null)
		.sort((a, b) => {
			const aTime = Date.parse(a.metadata.startedAt || a.metadata.createdAt);
			const bTime = Date.parse(b.metadata.startedAt || b.metadata.createdAt);
			return bTime - aTime;
		});
}

export function findListenRecordingById(
	id: string,
	recordingsDir?: string,
): ListenRecordingSummary | null {
	const trimmed = id.trim();
	if (!trimmed) return null;
	return (
		listListenRecordings(recordingsDir).find(
			(recording) => recording.id === trimmed,
		) ?? null
	);
}

export function deleteListenRecordingById(
	id: string,
	recordingsDir?: string,
): boolean {
	const recording = findListenRecordingById(id, recordingsDir);
	if (!recording) return false;
	fs.rmSync(recording.dir, { recursive: true });
	return true;
}

function resolveFilePath(
	recordingDir: string,
	relativeOrAbsolute?: string,
	fallbackName?: string,
): string | undefined {
	if (relativeOrAbsolute?.trim()) {
		const candidate = path.isAbsolute(relativeOrAbsolute)
			? relativeOrAbsolute
			: path.join(recordingDir, relativeOrAbsolute);
		if (fs.existsSync(candidate)) return candidate;
	}
	if (fallbackName) {
		const fallback = path.join(recordingDir, fallbackName);
		if (fs.existsSync(fallback)) return fallback;
	}
	return undefined;
}

export function recordingHasTranscript(
	recording: ListenRecordingSummary,
): boolean {
	const transcriptPath = resolveFilePath(
		recording.dir,
		recording.metadata.files.transcript,
		TRANSCRIPT_TXT,
	);
	if (!transcriptPath) return false;
	try {
		return fs.readFileSync(transcriptPath, "utf8").trim().length > 0;
	} catch {
		return false;
	}
}

export function recordingHasSummary(
	recording: ListenRecordingSummary,
): boolean {
	const summaryPath = resolveFilePath(
		recording.dir,
		recording.metadata.files.summary,
		SUMMARY_MD,
	);
	if (!summaryPath) return false;
	try {
		return fs.readFileSync(summaryPath, "utf8").trim().length > 0;
	} catch {
		return false;
	}
}

export function recordingHasAudio(recording: ListenRecordingSummary): boolean {
	return resolveListenRecordingAudioPath(recording) !== undefined;
}

export function resolveListenRecordingAudioPath(
	recording: ListenRecordingSummary,
): string | undefined {
	return (
		resolveListenRecordingCombinedPath(recording) ??
		resolveListenRecordingMicPath(recording) ??
		resolveListenRecordingSystemPath(recording)
	);
}

export function resolveListenRecordingCombinedPath(
	recording: ListenRecordingSummary,
): string | undefined {
	return resolveFilePath(
		recording.dir,
		recording.metadata.files.combined,
		COMBINED_M4A,
	);
}

export function resolveListenRecordingMicPath(
	recording: ListenRecordingSummary,
): string | undefined {
	return resolveFilePath(recording.dir, recording.metadata.files.mic, MIC_WAV);
}

export function resolveListenRecordingSystemPath(
	recording: ListenRecordingSummary,
): string | undefined {
	return resolveFilePath(
		recording.dir,
		recording.metadata.files.system,
		SYSTEM_WAV,
	);
}

export type ReadListenTranscriptResult =
	| {
			readonly ok: true;
			readonly text: string;
			readonly segments?: TranscriptPayload["segments"];
			readonly sourceAudio?: string;
			readonly locale?: string;
			readonly createdAt?: string;
			readonly warnings?: readonly string[];
	  }
	| {
			readonly ok: false;
			readonly error: string;
	  };

function readRecordingMetadata(
	recordingDir: string,
): ListenRecordingMetadata | undefined {
	const file = metadataPath(recordingDir);
	if (!fs.existsSync(file)) return undefined;
	try {
		return JSON.parse(fs.readFileSync(file, "utf8")) as ListenRecordingMetadata;
	} catch {
		return undefined;
	}
}

export function readListenTranscript(
	recordingDir: string,
	options?: { readonly includeSegments?: boolean },
): ReadListenTranscriptResult {
	const metadata = readRecordingMetadata(recordingDir);
	const transcriptPath = resolveFilePath(
		recordingDir,
		metadata?.files.transcript,
		TRANSCRIPT_TXT,
	);
	let text = "";
	if (transcriptPath) {
		try {
			text = fs.readFileSync(transcriptPath, "utf8").trim();
		} catch (e) {
			return {
				ok: false,
				error:
					e instanceof Error ? e.message : "Could not read transcript.txt.",
			};
		}
	}

	if (!text) {
		return {
			ok: false,
			error:
				"No transcript is available for this recording. Retry with `toby listen transcribe <recording-folder>`.",
		};
	}

	if (!options?.includeSegments) {
		return { ok: true, text };
	}

	const jsonPath = resolveFilePath(
		recordingDir,
		metadata?.files.transcriptJson,
		TRANSCRIPT_JSON,
	);
	if (!jsonPath) {
		return {
			ok: true,
			text,
			warnings: ["transcript.json not found; returned plain text only."],
		};
	}

	try {
		const payload = JSON.parse(
			fs.readFileSync(jsonPath, "utf8"),
		) as TranscriptPayload;
		return {
			ok: true,
			text,
			segments: payload.segments,
			sourceAudio: payload.sourceAudio,
			locale: payload.locale,
			createdAt: payload.createdAt,
		};
	} catch {
		return {
			ok: true,
			text,
			warnings: [
				"transcript.json could not be parsed; returned plain text only.",
			],
		};
	}
}

export type ReadListenSummaryResult =
	| {
			readonly ok: true;
			readonly text: string;
			readonly meta?: ListenRecordingSummaryMeta;
	  }
	| {
			readonly ok: false;
			readonly error: string;
	  };

export function readListenSummary(
	recordingDir: string,
): ReadListenSummaryResult {
	const metadata = readRecordingMetadata(recordingDir);
	const summaryPath = resolveFilePath(
		recordingDir,
		metadata?.files.summary,
		SUMMARY_MD,
	);
	if (!summaryPath) {
		return {
			ok: false,
			error: "No summary is available for this recording.",
		};
	}
	try {
		const text = fs.readFileSync(summaryPath, "utf8").trim();
		if (!text) {
			return {
				ok: false,
				error: "No summary is available for this recording.",
			};
		}
		return {
			ok: true,
			text,
			meta: metadata?.summary,
		};
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : "Could not read summary.md.",
		};
	}
}

/**
 * Persist a summary for a recording: write `summary.md` and update metadata.
 * Replaces any existing summary.
 */
export function writeListenSummary(
	recording: ListenRecordingSummary,
	params: {
		readonly text: string;
		readonly personaName?: string;
		readonly createdAt?: string;
	},
): ListenRecordingSummary {
	const text = params.text.trim();
	if (!text) {
		throw new Error("Cannot write an empty summary.");
	}
	const summaryFile = SUMMARY_MD;
	const summaryPath = path.join(recording.dir, summaryFile);
	fs.writeFileSync(summaryPath, `${text}\n`, "utf8");

	const createdAt = params.createdAt ?? new Date().toISOString();
	const nextMetadata: ListenRecordingMetadata = {
		...recording.metadata,
		files: {
			...recording.metadata.files,
			summary: summaryFile,
		},
		summary: {
			createdAt,
			...(params.personaName ? { personaName: params.personaName } : {}),
		},
	};
	fs.writeFileSync(
		metadataPath(recording.dir),
		`${JSON.stringify(nextMetadata, null, 2)}\n`,
	);
	return {
		id: recording.id,
		dir: recording.dir,
		metadata: nextMetadata,
	};
}

/**
 * Remove a persisted summary (file + metadata fields). Safe if none exists.
 * Used when re-transcribing so a stale summary cannot outlive a new transcript.
 */
export function clearListenSummary(
	recording: ListenRecordingSummary,
): ListenRecordingSummary {
	const summaryPath = resolveFilePath(
		recording.dir,
		recording.metadata.files.summary,
		SUMMARY_MD,
	);
	if (summaryPath) {
		try {
			fs.unlinkSync(summaryPath);
		} catch {
			// ignore missing file
		}
	}

	const { summary: _summaryFile, ...restFiles } = recording.metadata.files;
	const { summary: _summaryMeta, ...restMeta } = recording.metadata;
	const nextMetadata: ListenRecordingMetadata = {
		...restMeta,
		files: restFiles,
	};
	fs.writeFileSync(
		metadataPath(recording.dir),
		`${JSON.stringify(nextMetadata, null, 2)}\n`,
	);
	return {
		id: recording.id,
		dir: recording.dir,
		metadata: nextMetadata,
	};
}
