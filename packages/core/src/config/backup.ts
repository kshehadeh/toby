import fs from "node:fs";
import {
	BackupArchiveReader,
	BackupArchiveWriter,
	isBackupArchiveFile,
} from "./backup-archive";
import {
	type EncryptedBackupFile,
	decryptBackupPayload,
	encryptBackupPayload,
	isEncryptedBackupFile,
} from "./backup-crypto";
import {
	type StageArchiveRestoreResult,
	stageArchiveRestore,
} from "./backup-file-restore";
import { appendFileSectionsToArchive } from "./backup-files";
import {
	type DatabaseBackupBundle,
	createDatabaseBackupBundle,
	isDatabaseBackupBundle,
	stageDatabaseRestore,
} from "./database-backup";
import {
	type CredentialsFile,
	readConfigRaw,
	readCredentials,
	writeConfigRaw,
	writeCredentials,
} from "./index";

export interface ConfigBackupPayload {
	version: 1 | 2;
	createdAt: string;
	/** Full config.json object (integrations connection state, personas, etc.). */
	config: Record<string, unknown>;
	/**
	 * Full credentials bag after decrypt (integrations.<plugin> fields, AI keys,
	 * transcription keys, etc.).
	 */
	credentials: CredentialsFile | Record<string, unknown>;
	/** Present in version 2 complete backups. */
	databases?: DatabaseBackupBundle;
}

export function buildBackupFileName(date = new Date()): string {
	const timestamp = date.toISOString().replace(/[:.]/g, "-");
	return `toby-config-backup-${timestamp}.tbybak`;
}

export interface CreateConfigBackupResult {
	/** Path of the written archive. */
	readonly filePath: string;
	readonly suggestedFileName: string;
	/** Human-readable notes for files excluded from the backup. */
	readonly skipped: readonly string[];
}

/**
 * Create a complete password-protected backup archive at `outputPath`.
 *
 * Sections: settings + credentials (meta), chat/memory databases, project
 * folder files, recording files, and the file manifest. Databases are
 * snapshotted transactionally; file sections stream from disk so large
 * recording libraries do not need to fit in memory.
 */
export async function createConfigBackupArchive(
	password: string,
	outputPath: string,
): Promise<CreateConfigBackupResult> {
	const trimmed = password.trim();
	if (!trimmed) {
		throw new Error("Backup password cannot be empty.");
	}
	// Use raw config.json so plugin connection state, listen, and any extra
	// keys survive backup/restore. Credentials go through readCredentials so
	// on-disk encryption (Keychain-wrapped) is decrypted first.
	const meta = {
		version: 3,
		createdAt: new Date().toISOString(),
		config: readConfigRaw(),
		credentials: readCredentials(),
	};
	const writer = new BackupArchiveWriter(outputPath, trimmed);
	await writer.writeSection("meta", Buffer.from(JSON.stringify(meta), "utf8"));
	await writer.writeSection(
		"databases",
		Buffer.from(JSON.stringify(createDatabaseBackupBundle()), "utf8"),
	);
	const manifest = await appendFileSectionsToArchive(writer);
	await writer.writeSection(
		"files-manifest",
		Buffer.from(JSON.stringify(manifest), "utf8"),
	);
	await writer.finish();
	return {
		filePath: outputPath,
		suggestedFileName: buildBackupFileName(),
		skipped: manifest.skipped,
	};
}

export type RestoreConfigBackupFileResult = StageArchiveRestoreResult;

/**
 * Restore from a backup file (v3 archive, or a legacy JSON v1/v2 payload).
 * Archives are staged and applied at the next daemon startup; legacy JSON
 * backups write settings immediately and stage only their databases.
 */
export async function restoreConfigBackupFile(
	filePath: string,
	password?: string,
): Promise<RestoreConfigBackupFileResult> {
	if (isBackupArchiveFile(filePath)) {
		const pwd = password?.trim() ?? "";
		if (!pwd) {
			throw new Error("This backup is encrypted. Enter the backup password.");
		}
		const reader = new BackupArchiveReader(filePath, pwd);
		try {
			const metaRaw = await reader.readSection("meta");
			const meta: unknown = JSON.parse(metaRaw.toString("utf8"));
			if (!isArchiveMeta(meta)) {
				throw new Error("Not a valid Toby config backup.");
			}
			return await stageArchiveRestore(reader, {
				requireDatabases: true,
				applySettings: {
					config: meta.config,
					credentials: meta.credentials,
				},
			});
		} finally {
			reader.close();
		}
	}

	// Legacy JSON envelope / plaintext payload.
	const raw = await fs.promises.readFile(filePath, "utf-8");
	const parsed: unknown = JSON.parse(raw);
	const restored = await restoreConfigBackup(parsed, password);
	return {
		databasesStaged: restored.databases !== undefined,
		projectsStaged: false,
		recordingsStaged: false,
	};
}

interface ArchiveMeta {
	readonly version: 3;
	readonly createdAt: string;
	readonly config: Record<string, unknown>;
	readonly credentials: CredentialsFile | Record<string, unknown>;
}

function isArchiveMeta(value: unknown): value is ArchiveMeta {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return (
		record.version === 3 &&
		typeof record.createdAt === "string" &&
		typeof record.config === "object" &&
		record.config !== null &&
		typeof record.credentials === "object" &&
		record.credentials !== null
	);
}

/**
 * Restore config + credentials from a backup object (encrypted envelope or
 * legacy plaintext payload). Throws on bad password or invalid shape.
 */
export async function restoreConfigBackup(
	rawBackup: unknown,
	password?: string,
): Promise<ConfigBackupPayload> {
	const payload = await parseRestorePayload(rawBackup, password);
	const config =
		typeof payload.config === "object" && payload.config !== null
			? (payload.config as Record<string, unknown>)
			: {};
	writeConfigRaw(config);
	writeCredentials(payload.credentials as CredentialsFile);
	if (payload.databases) {
		stageDatabaseRestore(payload.databases);
	}
	return payload;
}

export async function parseRestorePayload(
	rawBackup: unknown,
	password?: string,
): Promise<ConfigBackupPayload> {
	if (isEncryptedBackupFile(rawBackup)) {
		const pwd = password?.trim() ?? "";
		if (!pwd) {
			throw new Error("This backup is encrypted. Enter the backup password.");
		}
		const decrypted = await decryptBackupPayload(rawBackup, pwd);
		return parseBackupPayload(JSON.parse(decrypted));
	}

	// Legacy: entire file is the plaintext payload object (or JSON string).
	if (typeof rawBackup === "string") {
		return parseBackupPayload(JSON.parse(rawBackup));
	}
	return parseBackupPayload(rawBackup);
}

export function parseBackupPayload(value: unknown): ConfigBackupPayload {
	if (!isConfigBackupPayload(value)) {
		throw new Error("Not a valid Toby config backup.");
	}
	return value;
}

export function isConfigBackupPayload(
	value: unknown,
): value is ConfigBackupPayload {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		(record.version === 1 || record.version === 2) &&
		typeof record.createdAt === "string" &&
		typeof record.config === "object" &&
		record.config !== null &&
		typeof record.credentials === "object" &&
		record.credentials !== null &&
		(record.databases === undefined || isDatabaseBackupBundle(record.databases))
	);
}

export {
	encryptBackupPayload,
	decryptBackupPayload,
	isEncryptedBackupFile,
	type EncryptedBackupFile,
} from "./backup-crypto";
export { isBackupArchiveFile } from "./backup-archive";
