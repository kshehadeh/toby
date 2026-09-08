import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { closeToolResultCacheDb } from "../chat-pipeline/tool-result-cache";
import { resolveListenRecordingsDir } from "../listen/recordings";
import { closeMemoryDb, getDb as getMemoryDb } from "../memory/memory-store";
import { closeChatDb, getDb as getChatDb } from "../session-store";
import {
	getChatDbPath,
	getMemoryDbPath,
	getProjectsDir,
	resolveTobyDir,
} from "./index";

const SNAPSHOT_COMPRESSION = "gzip-base64";
/** Legacy staged-restore directory written by stageDatabaseRestore (v1). */
export const PENDING_DIR = ".pending-database-restore";
export const PENDING_MANIFEST = "database-restore.json";

/** Commit marker for staged restores applied at daemon startup. */
export interface PendingRestoreManifest {
	readonly version: 2;
	/** Directory name (relative to the Toby data root) holding staged data. */
	readonly pendingDir: string;
	readonly databases: boolean;
	readonly projects: boolean;
	readonly recordings: boolean;
}

export function isPendingRestoreManifest(
	value: unknown,
): value is PendingRestoreManifest {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return (
		record.version === 2 &&
		typeof record.pendingDir === "string" &&
		typeof record.databases === "boolean" &&
		typeof record.projects === "boolean" &&
		typeof record.recordings === "boolean"
	);
}

export interface DatabaseSnapshot {
	readonly compression: typeof SNAPSHOT_COMPRESSION;
	readonly data: string;
	readonly sha256: string;
	readonly uncompressedBytes: number;
}

export interface DatabaseBackupBundle {
	readonly version: 1;
	readonly chat: DatabaseSnapshot;
	readonly memory: DatabaseSnapshot;
}

type SqliteDatabase = {
	serialize(): Uint8Array;
	close(): void;
};

type DatabaseConstructor = {
	deserialize(bytes: Uint8Array): SqliteDatabase & {
		query(sql: string): { get(): Record<string, unknown> | undefined };
	};
};

function sha256(data: Uint8Array): string {
	return createHash("sha256").update(data).digest("hex");
}

function snapshotDatabase(db: SqliteDatabase): DatabaseSnapshot {
	const raw = Buffer.from(db.serialize());
	return {
		compression: SNAPSHOT_COMPRESSION,
		data: gzipSync(raw).toString("base64"),
		sha256: sha256(raw),
		uncompressedBytes: raw.length,
	};
}

/** Create a transactionally-consistent, in-memory snapshot of Toby's databases. */
export function createDatabaseBackupBundle(): DatabaseBackupBundle {
	// serialize() captures SQLite's committed in-memory view, avoiding unsafe
	// copies of an open database file and any journal/WAL sidecars.
	return {
		version: 1,
		chat: snapshotDatabase(getChatDb()),
		memory: snapshotDatabase(getMemoryDb()),
	};
}

function isDatabaseSnapshot(value: unknown): value is DatabaseSnapshot {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		record.compression === SNAPSHOT_COMPRESSION &&
		typeof record.data === "string" &&
		typeof record.sha256 === "string" &&
		typeof record.uncompressedBytes === "number" &&
		Number.isSafeInteger(record.uncompressedBytes) &&
		record.uncompressedBytes > 0
	);
}

export function isDatabaseBackupBundle(
	value: unknown,
): value is DatabaseBackupBundle {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		record.version === 1 &&
		isDatabaseSnapshot(record.chat) &&
		isDatabaseSnapshot(record.memory)
	);
}

function restoreBytes(snapshot: DatabaseSnapshot): Buffer {
	if (!isDatabaseSnapshot(snapshot)) {
		throw new Error("Database backup has an invalid snapshot shape.");
	}
	let raw: Buffer;
	try {
		raw = gunzipSync(Buffer.from(snapshot.data, "base64"));
	} catch {
		throw new Error("Database backup contains invalid compressed data.");
	}
	if (
		raw.length !== snapshot.uncompressedBytes ||
		sha256(raw) !== snapshot.sha256
	) {
		throw new Error("Database backup failed its integrity check.");
	}
	if (raw.subarray(0, 16).toString("utf8") !== "SQLite format 3\u0000") {
		throw new Error("Database backup is not a SQLite database.");
	}
	// Validate the complete SQLite image before touching live files.
	const { Database } = require("bun:sqlite") as {
		Database: DatabaseConstructor;
	};
	const db = Database.deserialize(raw);
	try {
		const result = db.query("PRAGMA quick_check").get();
		if (result?.quick_check !== "ok") {
			throw new Error("Database backup failed SQLite integrity validation.");
		}
	} finally {
		db.close();
	}
	return raw;
}

/** Validate and decode both databases without changing any live state. */
export function validateDatabaseBackupBundle(bundle: DatabaseBackupBundle): {
	chat: Buffer;
	memory: Buffer;
} {
	if (!isDatabaseBackupBundle(bundle)) {
		throw new Error("Not a valid Toby database backup.");
	}
	return {
		chat: restoreBytes(bundle.chat),
		memory: restoreBytes(bundle.memory),
	};
}

/**
 * Stage a complete database replacement. The next daemon startup applies it
 * before opening any SQLite singleton, making API/CLI restores restart-safe.
 */
export function stageDatabaseRestore(bundle: DatabaseBackupBundle): void {
	const bytes = validateDatabaseBackupBundle(bundle);
	const root = resolveTobyDir();
	const pending = path.join(root, PENDING_DIR);
	fs.mkdirSync(pending, { recursive: true, mode: 0o700 });
	writeAtomic(path.join(pending, "chat.sqlite"), bytes.chat);
	writeAtomic(path.join(pending, "memory.sqlite"), bytes.memory);
	writeAtomic(
		path.join(root, PENDING_MANIFEST),
		Buffer.from(
			JSON.stringify({ version: 1, pendingDir: PENDING_DIR }),
			"utf8",
		),
	);
}

/**
 * Apply a previously validated staged restore. Called at daemon startup before
 * any code opens chat.sqlite or memory.sqlite.
 */
export function applyPendingDatabaseRestore(): boolean {
	const root = resolveTobyDir();
	const manifestPath = path.join(root, PENDING_MANIFEST);
	if (!fs.existsSync(manifestPath)) return false;
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	} catch {
		throw new Error("Staged restore manifest is invalid.");
	}
	if (isPendingRestoreManifest(parsed)) {
		return applyPendingRestoreManifest(parsed, manifestPath);
	}
	// Legacy v1 manifest written by stageDatabaseRestore (databases only).
	return applyLegacyPendingRestore(manifestPath);
}

interface StagedSwap {
	readonly live: string;
	readonly staged: string;
	readonly backup: string;
	readonly isDir: boolean;
}

function removePath(target: string): void {
	fs.rmSync(target, { recursive: true, force: true });
}

/** Replace live targets with staged ones, rolling back fully on any failure. */
function applySwapList(swaps: StagedSwap[]): void {
	const applied: StagedSwap[] = [];
	try {
		for (const swap of swaps) {
			if (!fs.existsSync(swap.staged)) {
				throw new Error("Staged restore is incomplete.");
			}
			fs.mkdirSync(path.dirname(swap.live), { recursive: true });
			if (fs.existsSync(swap.live)) fs.renameSync(swap.live, swap.backup);
			fs.renameSync(swap.staged, swap.live);
			applied.push(swap);
		}
		for (const swap of applied) {
			removePath(swap.backup);
		}
	} catch (error) {
		// Restore every target already replaced, then rethrow rather than
		// claiming a partial restore.
		for (const swap of applied.reverse()) {
			if (fs.existsSync(swap.live)) removePath(swap.live);
			if (fs.existsSync(swap.backup)) fs.renameSync(swap.backup, swap.live);
		}
		throw error;
	}
}

function applyPendingRestoreManifest(
	manifest: PendingRestoreManifest,
	manifestPath: string,
): boolean {
	const root = resolveTobyDir();
	if (
		path.isAbsolute(manifest.pendingDir) ||
		manifest.pendingDir !== path.basename(manifest.pendingDir)
	) {
		throw new Error("Staged restore directory is invalid.");
	}
	const pending = path.join(root, manifest.pendingDir);
	const swaps: StagedSwap[] = [];
	if (manifest.databases) {
		swaps.push(
			{
				live: getChatDbPath(),
				staged: path.join(pending, "chat.sqlite"),
				backup: `${getChatDbPath()}.pre-restore`,
				isDir: false,
			},
			{
				live: getMemoryDbPath(),
				staged: path.join(pending, "memory.sqlite"),
				backup: `${getMemoryDbPath()}.pre-restore`,
				isDir: false,
			},
		);
	}
	if (manifest.projects) {
		swaps.push({
			live: getProjectsDir(),
			staged: path.join(pending, "projects"),
			backup: `${getProjectsDir()}.pre-restore`,
			isDir: true,
		});
	}
	if (manifest.recordings) {
		swaps.push({
			live: resolveListenRecordingsDir(),
			staged: path.join(pending, "recordings"),
			backup: `${resolveListenRecordingsDir()}.pre-restore`,
			isDir: true,
		});
	}

	// Close every known handle before atomically replacing live files.
	closeToolResultCacheDb();
	closeChatDb();
	closeMemoryDb();

	applySwapList(swaps);

	// Project files were restored into Toby-managed folders; repoint the
	// restored database rows so projects work on this Mac without touching
	// any original custom folders.
	if (manifest.projects && manifest.databases) {
		rewriteProjectFolderPaths(getChatDbPath());
	}

	// Remove the commit marker first: a crash afterwards leaves only a
	// harmless orphan staging directory, never a manifest without data.
	fs.unlinkSync(manifestPath);
	removePath(pending);
	// Best-effort cleanup of a legacy staged restore superseded by this one.
	removePath(path.join(root, PENDING_DIR));
	return true;
}

/** Rewrite every restored project's folder_path to its managed location. */
function rewriteProjectFolderPaths(chatDbPath: string): void {
	const { Database } = require("bun:sqlite") as {
		Database: new (
			path: string,
		) => SqliteDatabase & {
			query(sql: string): {
				all(): Record<string, unknown>[];
				run(params: Record<string, unknown>): void;
			};
		};
	};
	const db = new Database(chatDbPath);
	try {
		const rows = db.query("SELECT id FROM projects").all() as Array<{
			id: string;
		}>;
		const projectsDir = getProjectsDir();
		for (const row of rows) {
			db.query("UPDATE projects SET folder_path = $path WHERE id = $id").run({
				$path: path.join(projectsDir, row.id),
				$id: row.id,
			});
		}
	} finally {
		db.close();
	}
}

function applyLegacyPendingRestore(manifestPath: string): boolean {
	const root = resolveTobyDir();
	const pending = path.join(root, PENDING_DIR);
	const stagedChat = path.join(pending, "chat.sqlite");
	const stagedMemory = path.join(pending, "memory.sqlite");
	if (!fs.existsSync(stagedChat) || !fs.existsSync(stagedMemory)) {
		throw new Error("Staged database restore is incomplete.");
	}

	// Close every known handle before atomically replacing the two files.
	closeToolResultCacheDb();
	closeChatDb();
	closeMemoryDb();
	const backups = [
		{
			live: getChatDbPath(),
			staged: stagedChat,
			backup: `${getChatDbPath()}.pre-restore`,
		},
		{
			live: getMemoryDbPath(),
			staged: stagedMemory,
			backup: `${getMemoryDbPath()}.pre-restore`,
		},
	];
	const replaced: (typeof backups)[number][] = [];
	try {
		for (const item of backups) {
			if (fs.existsSync(item.live)) fs.renameSync(item.live, item.backup);
			fs.renameSync(item.staged, item.live);
			replaced.push(item);
		}
		for (const item of backups) {
			if (fs.existsSync(item.backup)) fs.unlinkSync(item.backup);
		}
		fs.rmSync(pending, { recursive: true, force: true });
		fs.unlinkSync(manifestPath);
		return true;
	} catch (error) {
		// Restore every database already replaced, then leave the
		// manifest/staging intact for a later retry rather than claiming a
		// partial restore.
		for (const item of replaced) {
			if (fs.existsSync(item.live)) fs.unlinkSync(item.live);
		}
		for (const item of backups) {
			if (fs.existsSync(item.backup)) {
				fs.renameSync(item.backup, item.live);
			}
		}
		throw error;
	}
}

export function writeAtomic(filePath: string, data: Uint8Array): void {
	const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	fs.writeFileSync(tmp, data, { mode: 0o600 });
	fs.renameSync(tmp, filePath);
}
