import fs from "node:fs";
import path from "node:path";
import { decryptBackupPayload, encryptBackupPayload } from "./backup-crypto";
import {
	createDatabaseBackupBundle,
	isDatabaseBackupBundle,
	stageDatabaseRestore,
} from "./database-backup";
import { getDeviceName, getSyncBlobStore } from "./sync-engine";
import { getSyncPassphrase } from "./sync-keychain";
import { readSyncState, writeSyncState } from "./sync-state";

const SNAPSHOT_DIR = "database-backups";
const SNAPSHOT_LIMIT = 10;
const SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FORMAT = "toby.database.backup.encrypted";

export interface DatabaseSyncBackupInfo {
	readonly filename: string;
	readonly deviceId: string;
	readonly deviceName: string;
	readonly createdAt: string;
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
	return path.join(rootDir(), SNAPSHOT_DIR, deviceId);
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
	return `${createdAt.replace(/[:.]/g, "-")}.json`;
}

function atomicWrite(filePath: string, value: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
	const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(value), {
		encoding: "utf8",
		mode: 0o600,
	});
	fs.renameSync(tmp, filePath);
}

/** Create a complete encrypted snapshot in the selected sync transport. */
export async function createDatabaseSyncBackup(): Promise<DatabaseSyncBackupInfo> {
	const state = readSyncState();
	if (!state.enabled || !state.databaseBackupsEnabled) {
		throw new Error("Database backups are not enabled.");
	}
	const password = getSyncPassphrase();
	if (!password) throw new Error("Sync password is missing from Keychain.");

	const createdAt = new Date().toISOString();
	const bundle = createDatabaseBackupBundle();
	const encrypted = await encryptBackupPayload(
		JSON.stringify({ version: 1, databases: bundle }),
		password,
	);
	const envelope: DatabaseSyncBackupFile = {
		version: 1,
		format: FORMAT,
		deviceId: state.deviceId,
		deviceName: getDeviceName(),
		createdAt,
		encryption: encrypted.encryption,
		ciphertext: encrypted.ciphertext,
	};
	const filename = fileName(createdAt);
	atomicWrite(path.join(deviceDir(state.deviceId), filename), envelope);
	pruneDeviceBackups(state.deviceId);
	writeSyncState({
		...state,
		lastDatabaseBackupAt: createdAt,
		lastDatabaseBackupError: null,
	});
	return {
		filename,
		deviceId: state.deviceId,
		deviceName: envelope.deviceName,
		createdAt,
	};
}

export function setDatabaseBackupsEnabled(enabled: boolean): void {
	const state = readSyncState();
	if (enabled && !state.enabled) {
		throw new Error("Enable settings sync before enabling database backups.");
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
	const base = path.join(rootDir(), SNAPSHOT_DIR);
	if (!fs.existsSync(base)) return [];
	const results: DatabaseSyncBackupInfo[] = [];
	for (const deviceId of fs.readdirSync(base)) {
		if (!isSafeComponent(deviceId)) continue;
		const dir = path.join(base, deviceId);
		if (!fs.statSync(dir).isDirectory()) continue;
		for (const filename of fs.readdirSync(dir)) {
			if (
				path.extname(filename) !== ".json" ||
				filename !== path.basename(filename)
			)
				continue;
			const parsed = readBackupFile(path.join(dir, filename));
			if (!parsed) continue;
			results.push({
				filename,
				deviceId: parsed.deviceId,
				deviceName: parsed.deviceName,
				createdAt: parsed.createdAt,
			});
		}
	}
	return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
	const envelope = readBackupFile(
		path.join(deviceDir(options.deviceId), options.filename),
	);
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

function pruneDeviceBackups(id: string): void {
	const dir = deviceDir(id);
	const files = fs
		.readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.sort()
		.reverse();
	for (const extra of files.slice(SNAPSHOT_LIMIT)) {
		fs.unlinkSync(path.join(dir, extra));
	}
}
