import fs from "node:fs";
import path from "node:path";
import { resolveTobyDir } from "./index";

export const FOLDER_SYNC_RELATIVE = path.join("Toby", "config-sync");

export type SyncBackend = "icloud" | "folder";

export function isSyncBackend(value: unknown): value is SyncBackend {
	return value === "icloud" || value === "folder";
}

export function resolveSyncBackend(value: unknown): SyncBackend {
	return isSyncBackend(value) ? value : "icloud";
}

/** Vault directory nested under the user-picked folder. */
export function resolveFolderSyncVaultDir(pickedPath: string): string {
	return path.join(path.resolve(pickedPath), FOLDER_SYNC_RELATIVE);
}

export function isFolderSyncPickedAvailable(
	pickedPath: string | undefined,
): boolean {
	if (!pickedPath?.trim()) {
		return false;
	}
	try {
		const picked = path.resolve(pickedPath.trim());
		return fs.existsSync(picked) && fs.statSync(picked).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Validates a user-picked folder for the folder sync backend.
 * Returns the resolved absolute picked path (not the nested vault dir).
 */
export function validateFolderSyncPickedPath(pickedPath: string): string {
	const trimmed = pickedPath.trim();
	if (!trimmed) {
		throw new Error("A folder path is required for folder sync.");
	}
	if (!path.isAbsolute(trimmed)) {
		throw new Error("Sync folder path must be an absolute path.");
	}
	const picked = path.resolve(trimmed);
	const vaultDir = resolveFolderSyncVaultDir(picked);
	const tobyDir = path.resolve(resolveTobyDir());
	if (isPathInside(picked, tobyDir) || isPathInside(vaultDir, tobyDir)) {
		throw new Error("Sync folder cannot be inside the Toby home directory.");
	}
	if (!fs.existsSync(picked)) {
		throw new Error(`Sync folder does not exist: ${picked}`);
	}
	if (!fs.statSync(picked).isDirectory()) {
		throw new Error(`Sync folder is not a directory: ${picked}`);
	}
	try {
		fs.mkdirSync(vaultDir, { recursive: true });
		fs.accessSync(vaultDir, fs.constants.W_OK);
	} catch {
		throw new Error(`Sync folder is not writable: ${picked}`);
	}
	return picked;
}

export function folderUnavailableMessage(
	pickedPath: string | undefined,
): string {
	if (!pickedPath?.trim()) {
		return "Sync folder path is missing.";
	}
	return `Sync folder is not available: ${path.resolve(pickedPath.trim())}`;
}

function isPathInside(inner: string, outer: string): boolean {
	const resolvedInner = path.resolve(inner);
	const resolvedOuter = path.resolve(outer);
	if (resolvedInner === resolvedOuter) {
		return true;
	}
	const rel = path.relative(resolvedOuter, resolvedInner);
	return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}
