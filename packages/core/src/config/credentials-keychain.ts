import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	CREDENTIALS_KEY_LENGTH,
	DEFAULT_KEYCHAIN_ACCOUNT,
	DEFAULT_KEYCHAIN_SERVICE,
} from "./credentials-crypto";

/**
 * Stores the 32-byte AES data-encryption key used to wrap credentials on disk.
 * Production uses macOS Keychain; tests use an in-memory store.
 */
export interface CredentialsKeyStore {
	/** Return the existing DEK, or null if none is stored. */
	getDataKey(): Buffer | null;
	/** Return existing DEK or create and store a new one. */
	getOrCreateDataKey(): Buffer;
	/** Remove the DEK (wipe / uninstall). */
	deleteDataKey(): void;
}

export type CredentialsKeyBackend = "keychain" | "memory" | "plaintext";

/** Env override: `memory` | `keychain` | `plaintext`. */
export const CREDENTIALS_KEY_BACKEND_ENV = "TOBY_CREDENTIALS_KEY_BACKEND";

let memoryStore: MemoryCredentialsKeyStore | null = null;
let resolvedStore: CredentialsKeyStore | null | undefined;
let resolvedBackend: CredentialsKeyBackend | undefined;

/**
 * Resolve which backend to use.
 * - `TOBY_CREDENTIALS_KEY_BACKEND=memory|keychain|plaintext` forces a choice
 * - default: `keychain` on darwin, `plaintext` elsewhere
 *
 * Safety: `memory` without `TOBY_DIR` is treated as `plaintext` so tests or
 * misconfiguration cannot encrypt the real `~/.toby/credentials.json` with a
 * process-local key that disappears when the process exits.
 */
export function resolveCredentialsKeyBackend(): CredentialsKeyBackend {
	const raw = process.env[CREDENTIALS_KEY_BACKEND_ENV]?.trim().toLowerCase();
	if (raw === "plaintext") {
		return "plaintext";
	}
	if (raw === "memory") {
		if (!process.env.TOBY_DIR?.trim()) {
			return "plaintext";
		}
		return "memory";
	}
	if (raw === "keychain") {
		return "keychain";
	}
	return process.platform === "darwin" ? "keychain" : "plaintext";
}

/**
 * Returns the active key store, or `null` when credentials should stay
 * plaintext on disk (`plaintext` backend).
 */
export function getCredentialsKeyStore(): CredentialsKeyStore | null {
	const backend = resolveCredentialsKeyBackend();
	if (resolvedStore !== undefined && resolvedBackend === backend) {
		return resolvedStore;
	}
	resolvedBackend = backend;
	if (backend === "plaintext") {
		resolvedStore = null;
		return null;
	}
	if (backend === "memory") {
		if (!memoryStore) {
			memoryStore = new MemoryCredentialsKeyStore();
		}
		resolvedStore = memoryStore;
		return memoryStore;
	}
	// keychain
	if (process.platform !== "darwin") {
		throw new Error(
			"Credentials Keychain backend is only supported on macOS. Set TOBY_CREDENTIALS_KEY_BACKEND=memory (with TOBY_DIR) or plaintext.",
		);
	}
	resolvedStore = new MacosSecurityCredentialsKeyStore();
	return resolvedStore;
}

/** Reset cached store selection (tests). */
export function resetCredentialsKeyStoreCache(): void {
	resolvedStore = undefined;
	resolvedBackend = undefined;
}

/** Clear the process-local memory DEK (tests). */
export function clearMemoryCredentialsKeyStore(): void {
	memoryStore?.deleteDataKey();
	memoryStore = null;
	if (resolvedBackend === "memory") {
		resolvedStore = undefined;
		resolvedBackend = undefined;
	}
}

export class MemoryCredentialsKeyStore implements CredentialsKeyStore {
	private key: Buffer | null = null;

	getDataKey(): Buffer | null {
		return this.key ? Buffer.from(this.key) : null;
	}

	getOrCreateDataKey(): Buffer {
		if (!this.key) {
			this.key = cryptoRandomKey();
		}
		return Buffer.from(this.key);
	}

	deleteDataKey(): void {
		this.key = null;
	}
}

/**
 * macOS Keychain DEK via the `security` CLI (no native addons; works with
 * bun compile). Password value is base64 of the 32-byte key.
 */
export class MacosSecurityCredentialsKeyStore implements CredentialsKeyStore {
	constructor(
		private readonly service: string = DEFAULT_KEYCHAIN_SERVICE,
		private readonly account: string = DEFAULT_KEYCHAIN_ACCOUNT,
	) {}

	getDataKey(): Buffer | null {
		const result = spawnSync(
			"security",
			["find-generic-password", "-a", this.account, "-s", this.service, "-w"],
			{ encoding: "utf-8" },
		);
		if (result.status !== 0) {
			return null;
		}
		const password = (result.stdout ?? "").trim();
		if (!password) {
			return null;
		}
		try {
			const key = Buffer.from(password, "base64");
			if (key.length !== CREDENTIALS_KEY_LENGTH) {
				return null;
			}
			return key;
		} catch {
			return null;
		}
	}

	getOrCreateDataKey(): Buffer {
		const existing = this.getDataKey();
		if (existing) {
			return existing;
		}
		const key = cryptoRandomKey();
		const password = key.toString("base64");
		// -U updates if the item exists; -w sets the password.
		// -A allows any app (CLI/daemon) to read without interactive ACL prompts.
		const add = spawnSync(
			"security",
			[
				"add-generic-password",
				"-a",
				this.account,
				"-s",
				this.service,
				"-w",
				password,
				"-U",
				"-A",
			],
			{ encoding: "utf-8" },
		);
		if (add.status !== 0) {
			const detail = (add.stderr ?? add.stdout ?? "").trim();
			throw new Error(
				`Failed to store credentials encryption key in macOS Keychain${detail ? `: ${detail}` : "."}`,
			);
		}
		// Refuse to proceed if the key cannot be read back — otherwise we would
		// write ciphertext that no future process can decrypt.
		const verified = this.getDataKey();
		if (!verified || !verified.equals(key)) {
			throw new Error(
				"Stored credentials encryption key in Keychain but could not read it back. Check Keychain Access permissions and try again.",
			);
		}
		return key;
	}

	deleteDataKey(): void {
		spawnSync(
			"security",
			["delete-generic-password", "-a", this.account, "-s", this.service],
			{ encoding: "utf-8" },
		);
	}
}

function cryptoRandomKey(): Buffer {
	return randomBytes(CREDENTIALS_KEY_LENGTH);
}
