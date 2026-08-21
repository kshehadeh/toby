import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureTobyDir, resolveTobyDir } from "./index";

const SECURE_FILE_MODE = 0o600;

export interface SyncState {
	version: 1;
	enabled: boolean;
	deviceId: string;
	lastAckedContentHash: string;
	lastAckedLamport: number;
	lastAckedUtc?: string;
	lastPushAt?: string;
	lastPullAt?: string;
	lastError?: string | null;
	vaultPath?: string;
	lastWriterDeviceName?: string;
	lastWriterDeviceId?: string;
}

export function getSyncStatePath(): string {
	return path.join(resolveTobyDir(), "sync-state.json");
}

export function defaultSyncState(): SyncState {
	return {
		version: 1,
		enabled: false,
		deviceId: randomUUID(),
		lastAckedContentHash: "",
		lastAckedLamport: 0,
	};
}

export function readSyncState(): SyncState {
	const filePath = getSyncStatePath();
	if (!fs.existsSync(filePath)) {
		return defaultSyncState();
	}
	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
		if (!isSyncState(parsed)) {
			return defaultSyncState();
		}
		return parsed;
	} catch {
		return defaultSyncState();
	}
}

export function writeSyncState(state: SyncState): void {
	ensureTobyDir();
	const filePath = getSyncStatePath();
	const dir = path.dirname(filePath);
	const tmp = path.join(
		dir,
		`.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
	);
	fs.writeFileSync(tmp, JSON.stringify(state, null, 2), {
		encoding: "utf-8",
		mode: SECURE_FILE_MODE,
	});
	fs.renameSync(tmp, filePath);
	try {
		fs.chmodSync(filePath, SECURE_FILE_MODE);
	} catch {
		// Best-effort on platforms that ignore mode.
	}
}

export function isSyncState(value: unknown): value is SyncState {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		record.version === 1 &&
		typeof record.enabled === "boolean" &&
		typeof record.deviceId === "string" &&
		record.deviceId.length > 0 &&
		typeof record.lastAckedContentHash === "string" &&
		typeof record.lastAckedLamport === "number"
	);
}
