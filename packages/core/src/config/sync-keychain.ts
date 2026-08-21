import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveCredentialsKeyBackend, resolveTobyDir } from "./index";

export const SYNC_KEYCHAIN_SERVICE = "dev.toby.sync";
export const SYNC_KEYCHAIN_ACCOUNT = "vault-passphrase";

const SECURE_FILE_MODE = 0o600;

let memoryPassphrase: string | null = null;

function passphraseFilePath(): string {
	return path.join(resolveTobyDir(), "sync-passphrase");
}

export function getSyncPassphrase(): string | null {
	const backend = resolveCredentialsKeyBackend();
	if (backend === "memory") {
		return memoryPassphrase;
	}
	if (backend === "keychain") {
		return readKeychainPassphrase();
	}
	return readPassphraseFile();
}

export function setSyncPassphrase(password: string): void {
	const trimmed = password.trim();
	if (!trimmed) {
		throw new Error("Sync password cannot be empty.");
	}
	const backend = resolveCredentialsKeyBackend();
	if (backend === "memory") {
		memoryPassphrase = trimmed;
		return;
	}
	if (backend === "keychain") {
		writeKeychainPassphrase(trimmed);
		return;
	}
	writePassphraseFile(trimmed);
}

export function deleteSyncPassphrase(): void {
	const backend = resolveCredentialsKeyBackend();
	if (backend === "memory") {
		memoryPassphrase = null;
		return;
	}
	if (backend === "keychain") {
		spawnSync(
			"security",
			[
				"delete-generic-password",
				"-a",
				SYNC_KEYCHAIN_ACCOUNT,
				"-s",
				SYNC_KEYCHAIN_SERVICE,
			],
			{ encoding: "utf-8" },
		);
		return;
	}
	const filePath = passphraseFilePath();
	if (fs.existsSync(filePath)) {
		fs.unlinkSync(filePath);
	}
}

/** Tests only. */
export function resetSyncPassphraseStore(): void {
	memoryPassphrase = null;
}

function readKeychainPassphrase(): string | null {
	if (process.platform !== "darwin") {
		return null;
	}
	const result = spawnSync(
		"security",
		[
			"find-generic-password",
			"-a",
			SYNC_KEYCHAIN_ACCOUNT,
			"-s",
			SYNC_KEYCHAIN_SERVICE,
			"-w",
		],
		{ encoding: "utf-8" },
	);
	if (result.status !== 0) {
		return null;
	}
	const password = (result.stdout ?? "").trim();
	return password || null;
}

function writeKeychainPassphrase(password: string): void {
	if (process.platform !== "darwin") {
		throw new Error(
			"Sync passphrase Keychain storage is only supported on macOS.",
		);
	}
	const add = spawnSync(
		"security",
		[
			"add-generic-password",
			"-a",
			SYNC_KEYCHAIN_ACCOUNT,
			"-s",
			SYNC_KEYCHAIN_SERVICE,
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
			`Failed to store the iCloud sync password in macOS Keychain${detail ? `: ${detail}` : "."}`,
		);
	}
	const verified = readKeychainPassphrase();
	if (verified !== password) {
		throw new Error(
			"Stored the iCloud sync password in Keychain but could not read it back. Check Keychain Access permissions and try again.",
		);
	}
}

function readPassphraseFile(): string | null {
	const filePath = passphraseFilePath();
	if (!fs.existsSync(filePath)) {
		return null;
	}
	const text = fs.readFileSync(filePath, "utf-8").trim();
	return text || null;
}

function writePassphraseFile(password: string): void {
	const filePath = passphraseFilePath();
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${password}\n`, {
		encoding: "utf-8",
		mode: SECURE_FILE_MODE,
	});
}
