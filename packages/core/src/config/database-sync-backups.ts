import fs from "node:fs";
import path from "node:path";
import {
	BackupArchiveReader,
	BackupArchiveWriter,
	readBackupArchiveHeader,
} from "./backup-archive";
import {
	decryptBackupPayload,
	type encryptBackupPayload,
} from "./backup-crypto";
import { stageArchiveRestore } from "./backup-file-restore";
import { appendFileSectionsToArchive } from "./backup-files";
import {
	createDatabaseBackupBundle,
	isDatabaseBackupBundle,
	stageDatabaseRestore,
} from "./database-backup";
import { SYNC_DATA_BACKUPS_DIR } from "./sync-blob-store";
import { getDeviceName, getSyncBlobStore } from "./sync-engine";
import { getSyncPassphrase } from "./sync-keychain";
import { readSyncState, writeSyncState } from "./sync-state";

/** Latest complete snapshots kept per Mac (chats, project files, recordings). */
export const DATABASE_SYNC_BACKUP_LIMIT = 3;
const SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FORMAT = "toby.database.backup.encrypted";

export interface DatabaseSyncBackupInfo {
	readonly filename: string;
	readonly deviceId: string;
	readonly deviceName: string;
	readonly createdAt: string;
	readonly path: string;
	readonly includesProjects: boolean;
	readonly includesRecordings: boolean;
}

interface DatabaseSyncBackupFile {
	readonly version: 1;
	readonly format: typeof FORMAT;
	readonly deviceId: string;
	readonly deviceName: string;
	readonly createdAt: string;
	readonly encryption: Awaited<
		ReturnType<typeof encryptBackupPayload>
	>["encryption"];
	readonly ciphertext: string;
}

function rootDir(): string {
	return getSyncBlobStore().rootDir;
}

function deviceDir(deviceId: string): string {
	return path.join(rootDir(), SYNC_DATA_BACKUPS_DIR, deviceId);
}

function isSafeComponent(value: string): boolean {
	return value === path.basename(value) && /^[a-zA-Z0-9_-]+$/.test(value);
}

function isBackupFile(value: unknown): value is DatabaseSyncBackupFile {
	if (!value || typeof value !== "object") return false;
	const r = value as Record<string, unknown>;
	return (
		r.version === 1 &&
		r.format === FORMAT &&
		typeof r.deviceId === "string" &&
		typeof r.deviceName === "string" &&
		typeof r.createdAt === "string" &&
		typeof r.ciphertext === "string" &&
		typeof r.encryption === "object" &&
		r.encryption !== null
	);
}

function fileName(createdAt = new Date().toISOString()): string {
	return `${createdAt.replace(/[:.]/g, "-")}.tbybak`;
}

/** Create a complete encrypted snapshot in the selected sync transport. */
export async function createDatabaseSyncBackup(): Promise<DatabaseSyncBackupInfo> {
	const state = readSyncState();
	if (!state.enabled || !state.databaseBackupsEnabled) {
		throw new Error("Data backups are not enabled.");
	}
	const password = getSyncPassphrase();
	if (!password) throw new Error("Sync password is missing from Keychain.");

	const createdAt = new Date().toISOString();
	const filename = fileName(createdAt);
	const finalPath = path.join(deviceDir(state.deviceId), filename);
	const tmpPath = `${finalPath}.${process.pid}.tmp`;
	// Streamed archive: databases plus project folder files and recordings.
	const writer = new BackupArchiveWriter(tmpPath, password);
	try {
		await writer.writeSection(
			"databases",
			Buffer.from(JSON.stringify(createDatabaseBackupBundle()), "utf8"),
		);
		const manifest = await appendFileSectionsToArchive(writer);
		await writer.writeSection(
			"files-manifest",
			Buffer.from(JSON.stringify(manifest), "utf8"),
		);
		await writer.finish({
			deviceId: state.deviceId,
			deviceName: getDeviceName(),
			kind: "database",
			createdAt,
		});
	} catch (error) {
		fs.rmSync(tmpPath, { force: true });
		throw error;
	}
	fs.renameSync(tmpPath, finalPath);
	pruneDeviceBackups(state.deviceId);
	writeSyncState({
		...state,
		lastDatabaseBackupAt: createdAt,
		lastDatabaseBackupError: null,
	});
	return {
		filename,
		deviceId: state.deviceId,
		deviceName: getDeviceName(),
		createdAt,
		path: finalPath,
		includesProjects: true,
		includesRecordings: true,
	};
}

export function setDatabaseBackupsEnabled(enabled: boolean): void {
	const state = readSyncState();
	if (enabled && !state.enabled) {
		throw new Error("Enable settings sync before enabling data backups.");
	}
	writeSyncState({
		...state,
		databaseBackupsEnabled: enabled,
		lastDatabaseBackupError: null,
	});
}

export function shouldCreateDatabaseSyncBackup(now = Date.now()): boolean {
	const state = readSyncState();
	if (!state.enabled || !state.databaseBackupsEnabled) return false;
	if (!state.lastDatabaseBackupAt) return true;
	const last = Date.parse(state.lastDatabaseBackupAt);
	return Number.isNaN(last) || now - last >= SNAPSHOT_INTERVAL_MS;
}

export async function runDatabaseBackupTick(): Promise<boolean> {
	if (!shouldCreateDatabaseSyncBackup()) return false;
	try {
		await createDatabaseSyncBackup();
		return true;
	} catch (error) {
		const state = readSyncState();
		writeSyncState({
			...state,
			lastDatabaseBackupError:
				error instanceof Error ? error.message : String(error),
		});
		return false;
	}
}

export async function listDatabaseSyncBackups(): Promise<
	DatabaseSyncBackupInfo[]
> {
	pruneAllDeviceBackups();
	const results: DatabaseSyncBackupInfo[] = [];
	const base = path.join(rootDir(), SYNC_DATA_BACKUPS_DIR);
	if (!fs.existsSync(base)) return [];
	for (const deviceId of fs.readdirSync(base)) {
		if (!isSafeComponent(deviceId)) continue;
		results.push(...collectDeviceBackups(deviceId));
	}
	return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function collectDeviceBackups(deviceId: string): DatabaseSyncBackupInfo[] {
	const dir = deviceDir(deviceId);
	if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
	const results: DatabaseSyncBackupInfo[] = [];
	for (const filename of fs.readdirSync(dir)) {
		if (filename !== path.basename(filename)) continue;
		const filePath = path.join(dir, filename);
		const info = readBackupInfo(filePath, deviceId, filename);
		if (info) results.push(info);
	}
	return results;
}

function readBackupInfo(
	filePath: string,
	deviceId: string,
	filename: string,
): DatabaseSyncBackupInfo | null {
	if (filename.endsWith(".tbybak")) {
		try {
			const header = readBackupArchiveHeader(filePath);
			return {
				filename,
				deviceId: header.info?.deviceId ?? deviceId,
				deviceName: header.info?.deviceName ?? "Unknown Mac",
				createdAt: header.info?.createdAt ?? header.createdAt,
				path: filePath,
				includesProjects: header.sections["projects-files"] !== undefined,
				includesRecordings: header.sections["recordings-files"] !== undefined,
			};
		} catch {
			return null;
		}
	}
	if (filename.endsWith(".json")) {
		const parsed = readBackupFile(filePath);
		if (!parsed) return null;
		return {
			filename,
			deviceId: parsed.deviceId,
			deviceName: parsed.deviceName,
			createdAt: parsed.createdAt,
			path: filePath,
			includesProjects: false,
			includesRecordings: false,
		};
	}
	return null;
}

/** Validate a selected encrypted snapshot and stage it for next daemon startup. */
export async function restoreDatabaseSyncBackup(options: {
	deviceId: string;
	filename: string;
}): Promise<void> {
	if (
		!isSafeComponent(options.deviceId) ||
		options.filename !== path.basename(options.filename)
	) {
		throw new Error("Invalid database backup path.");
	}
	const password = getSyncPassphrase();
	if (!password) throw new Error("Sync password is missing from Keychain.");
	const filePath = path.join(deviceDir(options.deviceId), options.filename);

	if (filePath.endsWith(".tbybak")) {
		const reader = new BackupArchiveReader(filePath, password);
		try {
			// Stages databases, project files, and recordings for the next
			// daemon startup. Settings are not touched by database backups.
			await stageArchiveRestore(reader, { requireDatabases: true });
		} finally {
			reader.close();
		}
		return;
	}

	// Legacy JSON snapshots (databases only).
	const envelope = readBackupFile(filePath);
	if (!envelope)
		throw new Error("Database backup was not found or is invalid.");
	const plaintext = await decryptBackupPayload(
		{
			version: 2,
			format: "toby.config.backup.encrypted",
			createdAt: envelope.createdAt,
			encryption: envelope.encryption,
			ciphertext: envelope.ciphertext,
		},
		password,
	);
	let payload: unknown;
	try {
		payload = JSON.parse(plaintext);
	} catch {
		throw new Error("Database backup payload is not valid JSON.");
	}
	const databases =
		payload && typeof payload === "object"
			? (payload as { databases?: unknown }).databases
			: undefined;
	if (!isDatabaseBackupBundle(databases)) {
		throw new Error("Database backup payload is invalid.");
	}
	stageDatabaseRestore(databases);
}

function readBackupFile(filePath: string): DatabaseSyncBackupFile | null {
	try {
		const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
		return isBackupFile(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function pruneAllDeviceBackups(): void {
	const base = path.join(rootDir(), SYNC_DATA_BACKUPS_DIR);
	if (!fs.existsSync(base)) return;
	for (const deviceId of fs.readdirSync(base)) {
		if (!isSafeComponent(deviceId)) continue;
		pruneDeviceBackups(deviceId);
	}
}

function pruneDeviceBackups(id: string): void {
	const dir = deviceDir(id);
	if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
	const ranked: { path: string; createdAt: string }[] = [];
	for (const filename of fs.readdirSync(dir)) {
		if (filename !== path.basename(filename)) continue;
		if (!filename.endsWith(".json") && !filename.endsWith(".tbybak")) continue;
		const filePath = path.join(dir, filename);
		const info = readBackupInfo(filePath, id, filename);
		ranked.push({
			path: filePath,
			createdAt: info?.createdAt ?? filename,
		});
	}
	ranked.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	for (const extra of ranked.slice(DATABASE_SYNC_BACKUP_LIMIT)) {
		try {
			fs.unlinkSync(extra.path);
		} catch {
			// Best-effort prune (iCloud placeholders, already-deleted files).
		}
	}
}
