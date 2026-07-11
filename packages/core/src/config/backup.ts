import {
	type EncryptedBackupFile,
	decryptBackupPayload,
	encryptBackupPayload,
	isEncryptedBackupFile,
} from "./backup-crypto";
import {
	type CredentialsFile,
	readConfigRaw,
	readCredentials,
	writeConfigRaw,
	writeCredentials,
} from "./index";

export interface ConfigBackupPayload {
	version: 1;
	createdAt: string;
	/** Full config.json object (integrations connection state, personas, etc.). */
	config: Record<string, unknown>;
	/**
	 * Full credentials bag after decrypt (integrations.<plugin> fields, AI keys,
	 * transcription keys, etc.).
	 */
	credentials: CredentialsFile | Record<string, unknown>;
}

export function buildBackupFileName(date = new Date()): string {
	const timestamp = date.toISOString().replace(/[:.]/g, "-");
	return `toby-config-backup-${timestamp}.tbybak`;
}

/** Build and encrypt a password-protected config + credentials backup. */
export async function createEncryptedConfigBackup(
	password: string,
): Promise<{ backup: EncryptedBackupFile; suggestedFileName: string }> {
	const trimmed = password.trim();
	if (!trimmed) {
		throw new Error("Backup password cannot be empty.");
	}
	// Use raw config.json so plugin connection state, listen, and any extra
	// keys survive backup/restore. Credentials go through readCredentials so
	// on-disk encryption (Keychain-wrapped) is decrypted first.
	const payload: ConfigBackupPayload = {
		version: 1,
		createdAt: new Date().toISOString(),
		config: readConfigRaw(),
		credentials: readCredentials(),
	};
	const backup = await encryptBackupPayload(JSON.stringify(payload), trimmed);
	return { backup, suggestedFileName: buildBackupFileName() };
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
		record.version === 1 &&
		typeof record.createdAt === "string" &&
		typeof record.config === "object" &&
		record.config !== null &&
		typeof record.credentials === "object" &&
		record.credentials !== null
	);
}

export {
	encryptBackupPayload,
	decryptBackupPayload,
	isEncryptedBackupFile,
	type EncryptedBackupFile,
} from "./backup-crypto";
