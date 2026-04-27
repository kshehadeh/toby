import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	scryptSync,
} from "node:crypto";

const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

interface EncryptedBackupFile {
	version: 2;
	format: "toby.config.backup.encrypted";
	createdAt: string;
	encryption: {
		cipher: "aes-256-gcm";
		kdf: "scrypt";
		n: number;
		r: number;
		p: number;
		keyLength: number;
		salt: string;
		iv: string;
		authTag: string;
	};
	ciphertext: string;
}

export async function encryptBackupPayload(
	plaintext: string,
	password: string,
): Promise<EncryptedBackupFile> {
	const salt = randomBytes(SALT_LENGTH);
	const iv = randomBytes(IV_LENGTH);
	const key = scryptSync(password, salt, KEY_LENGTH, {
		N: SCRYPT_N,
		r: SCRYPT_R,
		p: SCRYPT_P,
	}) as Buffer;

	const cipher = createCipheriv("aes-256-gcm", key, iv);
	const encrypted = Buffer.concat([
		cipher.update(Buffer.from(plaintext, "utf-8")),
		cipher.final(),
	]);
	const authTag = cipher.getAuthTag();

	return {
		version: 2,
		format: "toby.config.backup.encrypted",
		createdAt: new Date().toISOString(),
		encryption: {
			cipher: "aes-256-gcm",
			kdf: "scrypt",
			n: SCRYPT_N,
			r: SCRYPT_R,
			p: SCRYPT_P,
			keyLength: KEY_LENGTH,
			salt: salt.toString("base64"),
			iv: iv.toString("base64"),
			authTag: authTag.toString("base64"),
		},
		ciphertext: encrypted.toString("base64"),
	};
}

export async function decryptBackupPayload(
	backup: EncryptedBackupFile,
	password: string,
): Promise<string> {
	try {
		const salt = Buffer.from(backup.encryption.salt, "base64");
		const iv = Buffer.from(backup.encryption.iv, "base64");
		const authTag = Buffer.from(backup.encryption.authTag, "base64");
		const ciphertext = Buffer.from(backup.ciphertext, "base64");
		const key = scryptSync(password, salt, backup.encryption.keyLength, {
			N: backup.encryption.n,
			r: backup.encryption.r,
			p: backup.encryption.p,
		}) as Buffer;

		const decipher = createDecipheriv("aes-256-gcm", key, iv);
		decipher.setAuthTag(authTag);
		const decrypted = Buffer.concat([
			decipher.update(ciphertext),
			decipher.final(),
		]);
		return decrypted.toString("utf-8");
	} catch {
		throw new Error(
			"Could not decrypt backup. Check that the password is correct and the file is valid.",
		);
	}
}

export function isEncryptedBackupFile(
	value: unknown,
): value is EncryptedBackupFile {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const record = value as Record<string, unknown>;
	if (
		record.version !== 2 ||
		record.format !== "toby.config.backup.encrypted" ||
		typeof record.createdAt !== "string" ||
		typeof record.ciphertext !== "string"
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
