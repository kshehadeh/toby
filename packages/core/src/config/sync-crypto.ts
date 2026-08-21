import {
	type EncryptedBackupFile,
	decryptBackupPayload,
	encryptBackupPayload,
} from "./backup-crypto";
import { type SyncClock, isSyncClock } from "./sync-clock";

export const SYNC_ENVELOPE_FORMAT = "toby.config.sync.encrypted";

export interface EncryptedSyncFile {
	version: 1;
	format: typeof SYNC_ENVELOPE_FORMAT;
	clock: SyncClock;
	contentHash: string;
	createdAt: string;
	encryption: EncryptedBackupFile["encryption"];
	ciphertext: string;
}

export async function encryptSyncPayload(
	plaintext: string,
	password: string,
	meta: {
		clock: SyncClock;
		contentHash: string;
		createdAt: string;
	},
): Promise<EncryptedSyncFile> {
	const backup = await encryptBackupPayload(plaintext, password);
	return {
		version: 1,
		format: SYNC_ENVELOPE_FORMAT,
		clock: meta.clock,
		contentHash: meta.contentHash,
		createdAt: meta.createdAt,
		encryption: backup.encryption,
		ciphertext: backup.ciphertext,
	};
}

export async function decryptSyncPayload(
	file: EncryptedSyncFile,
	password: string,
): Promise<string> {
	const backup: EncryptedBackupFile = {
		version: 2,
		format: "toby.config.backup.encrypted",
		createdAt: file.createdAt,
		encryption: file.encryption,
		ciphertext: file.ciphertext,
	};
	try {
		return await decryptBackupPayload(backup, password);
	} catch {
		throw new Error(
			"Could not decrypt the sync vault. Check that the password is correct.",
		);
	}
}

export function isEncryptedSyncFile(
	value: unknown,
): value is EncryptedSyncFile {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const record = value as Record<string, unknown>;
	if (
		record.version !== 1 ||
		record.format !== SYNC_ENVELOPE_FORMAT ||
		typeof record.contentHash !== "string" ||
		typeof record.createdAt !== "string" ||
		typeof record.ciphertext !== "string" ||
		!isSyncClock(record.clock)
	) {
		return false;
	}
	if (typeof record.encryption !== "object" || record.encryption === null) {
		return false;
	}
	const encryption = record.encryption as Record<string, unknown>;
	return (
		encryption.cipher === "aes-256-gcm" &&
		encryption.kdf === "scrypt" &&
		typeof encryption.n === "number" &&
		typeof encryption.r === "number" &&
		typeof encryption.p === "number" &&
		typeof encryption.keyLength === "number" &&
		typeof encryption.salt === "string" &&
		typeof encryption.iv === "string" &&
		typeof encryption.authTag === "string"
	);
}
