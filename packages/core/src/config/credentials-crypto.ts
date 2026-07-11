import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const CREDENTIALS_ENVELOPE_FORMAT =
	"toby.credentials.encrypted" as const;
export const CREDENTIALS_ENVELOPE_VERSION = 1 as const;
export const CREDENTIALS_CIPHER = "aes-256-gcm" as const;
export const CREDENTIALS_KEY_LENGTH = 32;
export const CREDENTIALS_IV_LENGTH = 12;

export const DEFAULT_KEYCHAIN_SERVICE = "dev.toby.credentials";
export const DEFAULT_KEYCHAIN_ACCOUNT = "data-encryption-key";

export interface EncryptedCredentialsEnvelope {
	version: typeof CREDENTIALS_ENVELOPE_VERSION;
	format: typeof CREDENTIALS_ENVELOPE_FORMAT;
	encryption: {
		cipher: typeof CREDENTIALS_CIPHER;
		keySource: "keychain";
		keychainService: string;
		keychainAccount: string;
		iv: string;
		authTag: string;
	};
	ciphertext: string;
}

export function isEncryptedCredentialsEnvelope(
	value: unknown,
): value is EncryptedCredentialsEnvelope {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const record = value as Record<string, unknown>;
	if (
		record.version !== CREDENTIALS_ENVELOPE_VERSION ||
		record.format !== CREDENTIALS_ENVELOPE_FORMAT ||
		typeof record.ciphertext !== "string"
	) {
		return false;
	}
	if (typeof record.encryption !== "object" || record.encryption === null) {
		return false;
	}
	const encryption = record.encryption as Record<string, unknown>;
	return (
		encryption.cipher === CREDENTIALS_CIPHER &&
		encryption.keySource === "keychain" &&
		typeof encryption.keychainService === "string" &&
		typeof encryption.keychainAccount === "string" &&
		typeof encryption.iv === "string" &&
		typeof encryption.authTag === "string"
	);
}

/**
 * Encrypt plaintext credentials JSON with AES-256-GCM.
 * `dataKey` must be {@link CREDENTIALS_KEY_LENGTH} bytes.
 */
export function encryptCredentialsPayload(
	plaintext: string,
	dataKey: Buffer,
	options?: {
		keychainService?: string;
		keychainAccount?: string;
	},
): EncryptedCredentialsEnvelope {
	if (dataKey.length !== CREDENTIALS_KEY_LENGTH) {
		throw new Error(
			`Credentials data key must be ${CREDENTIALS_KEY_LENGTH} bytes`,
		);
	}
	const iv = randomBytes(CREDENTIALS_IV_LENGTH);
	const cipher = createCipheriv(CREDENTIALS_CIPHER, dataKey, iv);
	const encrypted = Buffer.concat([
		cipher.update(Buffer.from(plaintext, "utf-8")),
		cipher.final(),
	]);
	const authTag = cipher.getAuthTag();

	return {
		version: CREDENTIALS_ENVELOPE_VERSION,
		format: CREDENTIALS_ENVELOPE_FORMAT,
		encryption: {
			cipher: CREDENTIALS_CIPHER,
			keySource: "keychain",
			keychainService: options?.keychainService ?? DEFAULT_KEYCHAIN_SERVICE,
			keychainAccount: options?.keychainAccount ?? DEFAULT_KEYCHAIN_ACCOUNT,
			iv: iv.toString("base64"),
			authTag: authTag.toString("base64"),
		},
		ciphertext: encrypted.toString("base64"),
	};
}

/**
 * Decrypt an encrypted credentials envelope. Throws if authentication fails
 * or the key is wrong.
 */
export function decryptCredentialsPayload(
	envelope: EncryptedCredentialsEnvelope,
	dataKey: Buffer,
): string {
	if (dataKey.length !== CREDENTIALS_KEY_LENGTH) {
		throw new Error(
			`Credentials data key must be ${CREDENTIALS_KEY_LENGTH} bytes`,
		);
	}
	try {
		const iv = Buffer.from(envelope.encryption.iv, "base64");
		const authTag = Buffer.from(envelope.encryption.authTag, "base64");
		const ciphertext = Buffer.from(envelope.ciphertext, "base64");
		const decipher = createDecipheriv(CREDENTIALS_CIPHER, dataKey, iv);
		decipher.setAuthTag(authTag);
		const decrypted = Buffer.concat([
			decipher.update(ciphertext),
			decipher.final(),
		]);
		return decrypted.toString("utf-8");
	} catch {
		throw new Error(
			"Could not decrypt credentials.json. The Keychain data key may be missing or different from the one used to encrypt this file. Restore from an encrypted backup (`toby config restore`) or re-enter secrets in Settings.",
		);
	}
}
