import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveTobyDir } from "@toby/core/config/index";
import {
	type ListenRecordingSummary,
	listListenRecordings,
	metadataPath,
	resolveListenRecordingsDir,
} from "@toby/core/listen/recordings";
import type {
	ListenRecordingFiles,
	ListenRecordingMetadata,
	ListenSession,
	ListenSourceSelection,
	ListenState,
} from "./types";
import { DEFAULT_LISTEN_SOURCES, selectedListenSources } from "./types";

export type { ListenRecordingSummary } from "@toby/core/listen/recordings";
export { listListenRecordings, metadataPath, resolveListenRecordingsDir };

const LISTEN_DIR = "listen";
const TEMP_DIR = "tmp";

function getListenDir(baseDir = resolveTobyDir()): string {
	return path.join(baseDir, LISTEN_DIR);
}

function getListenRecordingsDir(baseDir = resolveTobyDir()): string {
	return path.join(getListenDir(baseDir), "recordings");
}

function getListenTempDir(baseDir = resolveTobyDir()): string {
	return path.join(getListenDir(baseDir), TEMP_DIR);
}

function ensureListenDirs(baseDir = resolveTobyDir()): void {
	fs.mkdirSync(getListenRecordingsDir(baseDir), { recursive: true });
	fs.mkdirSync(getListenTempDir(baseDir), { recursive: true });
}

function ensureCustomRecordingDirs(recordingsDir: string): void {
	fs.mkdirSync(recordingsDir, { recursive: true });
	fs.mkdirSync(path.join(recordingsDir, ".tmp"), { recursive: true });
}

function createListenRecordingId(date = new Date()): string {
	const stamp = date.toISOString().replace(/[:.]/g, "-");
	const random = Math.random().toString(36).slice(2, 8);
	return `${stamp}-${random}`;
}

function validateListenSources(sources: ListenSourceSelection): void {
	if (selectedListenSources(sources).length === 0) {
		throw new Error("At least one listen source must be selected.");
	}
}

export function createInitialListenState(
	sources: ListenSourceSelection = DEFAULT_LISTEN_SOURCES,
): ListenState {
	return {
		status: "idle",
		sources,
		message: "Ready to record audio.",
	};
}

export function prepareListenSession(params: {
	readonly sources: ListenSourceSelection;
	readonly baseDir?: string;
	readonly recordingsDir?: string;
	readonly now?: Date;
	readonly id?: string;
}): ListenSession {
	validateListenSources(params.sources);
	const now = params.now ?? new Date();
	const baseDir = params.baseDir ?? resolveTobyDir();
	const id = params.id ?? createListenRecordingId(now);
	const recordingsDir = params.recordingsDir?.trim();
	if (recordingsDir) {
		ensureCustomRecordingDirs(recordingsDir);
		const tempDir = path.join(recordingsDir, ".tmp", id);
		const finalDir = path.join(recordingsDir, id);
		fs.mkdirSync(tempDir, { recursive: true });
		return {
			id,
			startedAt: now.toISOString(),
			tempDir,
			finalDir,
			sources: params.sources,
		};
	}
	ensureListenDirs(baseDir);
	const tempDir = path.join(getListenTempDir(baseDir), id);
	const finalDir = path.join(getListenRecordingsDir(baseDir), id);
	fs.mkdirSync(tempDir, { recursive: true });
	return {
		id,
		startedAt: now.toISOString(),
		tempDir,
		finalDir,
		sources: params.sources,
	};
}

function defaultListenRecordingFiles(
	session: ListenSession,
): ListenRecordingFiles {
	return {
		...(session.sources.mic
			? { mic: path.join(session.finalDir, "mic.wav") }
			: {}),
		...(session.sources.system
			? { system: path.join(session.finalDir, "system.wav") }
			: {}),
		combined: path.join(session.finalDir, "combined.m4a"),
	};
}

export function buildListenMetadata(params: {
	readonly session: ListenSession;
	readonly files?: ListenRecordingFiles;
	readonly stoppedAt?: Date;
	readonly helperPath?: string;
	readonly helperVersion?: string;
	readonly errors?: readonly string[];
}): ListenRecordingMetadata {
	const stoppedAt = params.stoppedAt;
	const startedMs = Date.parse(params.session.startedAt);
	const stoppedMs = stoppedAt ? stoppedAt.getTime() : undefined;
	return {
		id: params.session.id,
		createdAt: params.session.startedAt,
		startedAt: params.session.startedAt,
		...(stoppedAt ? { stoppedAt: stoppedAt.toISOString() } : {}),
		...(stoppedMs !== undefined
			? { durationMs: Math.max(0, stoppedMs - startedMs) }
			: {}),
		sources: params.session.sources,
		files: params.files ?? defaultListenRecordingFiles(params.session),
		platform: process.platform,
		osVersion: os.release(),
		helper:
			params.helperPath || params.helperVersion
				? {
						...(params.helperPath ? { path: params.helperPath } : {}),
						...(params.helperVersion ? { version: params.helperVersion } : {}),
					}
				: undefined,
		...(params.errors && params.errors.length > 0
			? { errors: [...params.errors] }
			: {}),
	};
}

export function writeListenMetadata(
	dir: string,
	metadata: ListenRecordingMetadata,
): void {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(metadataPath(dir), `${JSON.stringify(metadata, null, 2)}\n`);
}

export function saveListenSession(
	session: ListenSession,
	metadata: ListenRecordingMetadata,
): string {
	fs.mkdirSync(path.dirname(session.finalDir), { recursive: true });
	if (fs.existsSync(session.finalDir)) {
		fs.rmSync(session.finalDir, { recursive: true, force: true });
	}
	fs.renameSync(session.tempDir, session.finalDir);
	writeListenMetadata(session.finalDir, metadata);
	return session.finalDir;
}

export function discardListenSession(session: ListenSession): void {
	fs.rmSync(session.tempDir, { recursive: true, force: true });
}

export function deleteListenRecording(recording: ListenRecordingSummary): void {
	fs.rmSync(recording.dir, { recursive: true, force: true });
}

export function updateListenRecordingMetadata(
	recording: ListenRecordingSummary,
	patch: Pick<Partial<ListenRecordingMetadata>, "name" | "description">,
): ListenRecordingSummary {
	const next: ListenRecordingMetadata = {
		...recording.metadata,
		...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
		...(patch.description !== undefined
			? { description: patch.description.trim() }
			: {}),
	};
	writeListenMetadata(recording.dir, next);
	return {
		...recording,
		metadata: next,
	};
}

export function openListenRecordingInFinder(
	recording: ListenRecordingSummary,
): void {
	const result = spawnSync("open", [recording.dir], {
		stdio: "ignore",
	});
	if (result.error) {
		throw result.error;
	}
	if (typeof result.status === "number" && result.status !== 0) {
		throw new Error(`open exited with status ${result.status}`);
	}
}
