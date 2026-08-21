import { spawnSync } from "node:child_process";
import os from "node:os";
import { clearModelListCache } from "../ai/model-list";
import { invalidateSettingsCache } from "../configure/settings-cache";
import {
	type CredentialsFile,
	readConfigRaw,
	writeConfigRaw,
	writeCredentials,
} from "./index";
import {
	type SyncBlobStore,
	type SyncHistoryItem,
	isICloudDriveFolderAvailable,
	resolveSyncVaultDir,
} from "./sync-blob-store";
import { compareSyncClock, nextSyncClock } from "./sync-clock";
import {
	type EncryptedSyncFile,
	decryptSyncPayload,
	encryptSyncPayload,
} from "./sync-crypto";
import {
	beginApplyingRemote,
	clearSyncDirty,
	endApplyingRemote,
	isSyncDirty,
	markSyncDirty,
	shouldPushNow,
} from "./sync-dirty";
import {
	createNativeAwareSyncBlobStore,
	nativeICloudStatus,
} from "./sync-icloud-store";
import {
	deleteSyncPassphrase,
	getSyncPassphrase,
	setSyncPassphrase,
} from "./sync-keychain";
import {
	buildSyncPayload,
	hashPayload,
	localConfigLooksEmpty,
	mergeDeniedConfigKeys,
	parseSyncPayload,
} from "./sync-payload";
import { type SyncState, readSyncState, writeSyncState } from "./sync-state";

export type SyncEnableMode = "create" | "join" | "replace";

export interface SyncStatus {
	enabled: boolean;
	iCloudAvailable: boolean;
	deviceId: string;
	deviceName: string;
	vaultPath: string;
	lastPushAt?: string;
	lastPullAt?: string;
	lastError?: string | null;
	lastWriterDeviceName?: string;
	lastWriterDeviceId?: string;
	lastAckedLamport: number;
	lastAckedContentHash: string;
	dirty: boolean;
	hasRemote: boolean;
	remote?: {
		lamport: number;
		utc: string;
		deviceId: string;
		deviceName: string;
		contentHash: string;
	};
}

export interface PushResult {
	pushed: boolean;
	reason?: string;
	clockLamport?: number;
}

export interface PullResult {
	applied: boolean;
	reason?: string;
	pushedInstead?: boolean;
}

let injectedStore: SyncBlobStore | null = null;

export function getSyncBlobStore(): SyncBlobStore {
	if (injectedStore) {
		return injectedStore;
	}
	return createNativeAwareSyncBlobStore();
}

/** Tests / injection. */
export function setSyncBlobStoreForTests(store: SyncBlobStore | null): void {
	injectedStore = store;
}

export function getDeviceName(): string {
	if (process.platform === "darwin") {
		const result = spawnSync("scutil", ["--get", "ComputerName"], {
			encoding: "utf-8",
		});
		const name = (result.stdout ?? "").trim();
		if (result.status === 0 && name) {
			return name;
		}
	}
	return os.hostname();
}

export async function getSyncStatus(
	store: SyncBlobStore = getSyncBlobStore(),
): Promise<SyncStatus> {
	const state = readSyncState();
	const remote = await store.readCurrent().catch(() => null);
	const nativeStatus = await nativeICloudStatus().catch(() => null);
	return {
		enabled: state.enabled,
		iCloudAvailable: nativeStatus?.available ?? isICloudDriveFolderAvailable(),
		deviceId: state.deviceId,
		deviceName: getDeviceName(),
		vaultPath: store.rootDir,
		lastPushAt: state.lastPushAt,
		lastPullAt: state.lastPullAt,
		lastError: state.lastError,
		lastWriterDeviceName: state.lastWriterDeviceName,
		lastWriterDeviceId: state.lastWriterDeviceId,
		lastAckedLamport: state.lastAckedLamport,
		lastAckedContentHash: state.lastAckedContentHash,
		dirty: isSyncDirty(),
		hasRemote: remote !== null,
		remote: remote
			? {
					lamport: remote.clock.lamport,
					utc: remote.clock.utc,
					deviceId: remote.clock.deviceId,
					deviceName: remote.clock.deviceName,
					contentHash: remote.contentHash,
				}
			: undefined,
	};
}

export async function enableSync(options: {
	password: string;
	mode?: SyncEnableMode;
	store?: SyncBlobStore;
}): Promise<SyncStatus> {
	const password = options.password.trim();
	if (!password) {
		throw new Error("Sync password cannot be empty.");
	}
	const store = options.store ?? getSyncBlobStore();
	const remote = await store.readCurrent();
	let mode = options.mode;
	if (!mode) {
		mode = remote ? "join" : "create";
	}

	if (mode === "join" && !remote) {
		throw new Error(
			"No iCloud vault was found. Create one from a Mac that already has your settings.",
		);
	}
	if (mode === "create" && remote) {
		throw new Error(
			"An iCloud vault already exists. Join it with the existing password, or replace the cloud copy from this Mac.",
		);
	}
	if (mode === "replace" && remote && localConfigLooksEmpty()) {
		throw new Error(
			"This Mac has no settings to upload. Join the existing iCloud vault instead of replacing it.",
		);
	}

	if (mode === "join" && remote) {
		await decryptSyncPayload(remote, password);
	}

	setSyncPassphrase(password);
	const prior = readSyncState();
	writeSyncState({
		...prior,
		enabled: true,
		vaultPath: store.rootDir,
		lastError: null,
	});

	try {
		if (mode === "join" && remote) {
			await applyRemoteEnvelope(remote, password, store);
		} else {
			await pushSnapshot({ store, force: true });
		}
	} catch (error) {
		deleteSyncPassphrase();
		writeSyncState({ ...readSyncState(), enabled: false });
		throw error;
	}

	return getSyncStatus(store);
}

export async function disableSync(options: {
	store?: SyncBlobStore;
	deleteCloud?: boolean;
}): Promise<SyncStatus> {
	const store = options.store ?? getSyncBlobStore();
	if (options.deleteCloud) {
		await store.deleteAll();
	}
	deleteSyncPassphrase();
	const state = readSyncState();
	state.enabled = false;
	state.lastError = null;
	writeSyncState(state);
	clearSyncDirty();
	return getSyncStatus(store);
}

export async function pushSnapshot(options?: {
	store?: SyncBlobStore;
	force?: boolean;
}): Promise<PushResult> {
	const store = options?.store ?? getSyncBlobStore();
	const state = readSyncState();
	if (!state.enabled && !options?.force) {
		return { pushed: false, reason: "disabled" };
	}
	const password = getSyncPassphrase();
	if (!password) {
		recordError(state, "Sync password is missing from Keychain.");
		return { pushed: false, reason: "no-passphrase" };
	}

	const payload = buildSyncPayload();
	const contentHash = hashPayload(payload);
	if (!options?.force && contentHash === state.lastAckedContentHash) {
		clearSyncDirty();
		return { pushed: false, reason: "unchanged" };
	}

	const remote = await store.readCurrent().catch(() => null);
	const prevLamport = Math.max(
		state.lastAckedLamport,
		remote?.clock.lamport ?? 0,
	);
	const clock = nextSyncClock(prevLamport, state.deviceId, getDeviceName());
	const createdAt = clock.utc;
	const envelope = await encryptSyncPayload(JSON.stringify(payload), password, {
		clock,
		contentHash,
		createdAt,
	});
	await store.writeCurrent(envelope);

	const next: SyncState = {
		...state,
		enabled: true,
		lastAckedContentHash: contentHash,
		lastAckedLamport: clock.lamport,
		lastAckedUtc: clock.utc,
		lastPushAt: createdAt,
		lastError: null,
		vaultPath: store.rootDir,
		lastWriterDeviceName: clock.deviceName,
		lastWriterDeviceId: clock.deviceId,
	};
	writeSyncState(next);
	clearSyncDirty();
	return { pushed: true, clockLamport: clock.lamport };
}

export async function pullSnapshot(options?: {
	store?: SyncBlobStore;
	/** HTTP/CLI destructive apply must pass true. Automatic ticks omit this. */
	confirm?: boolean;
	automatic?: boolean;
}): Promise<PullResult> {
	const store = options?.store ?? getSyncBlobStore();
	const state = readSyncState();
	if (!state.enabled) {
		return { applied: false, reason: "disabled" };
	}
	if (!options?.automatic && options?.confirm !== true) {
		throw new Error("confirm must be true to apply a cloud snapshot.");
	}

	const password = getSyncPassphrase();
	if (!password) {
		recordError(state, "Sync password is missing from Keychain.");
		return { applied: false, reason: "no-passphrase" };
	}

	const remote = await store.readCurrent();
	if (!remote) {
		return { applied: false, reason: "no-remote" };
	}

	const localPayload = buildSyncPayload();
	const localHash = hashPayload(localPayload);
	if (remote.contentHash === localHash) {
		ackRemoteClock(state, remote, store);
		clearSyncDirty();
		return { applied: false, reason: "unchanged" };
	}

	const localClock = {
		lamport: state.lastAckedLamport,
		utc: state.lastAckedUtc ?? "",
		deviceId: state.deviceId,
		deviceName: getDeviceName(),
	};
	const remoteWins = compareSyncClock(remote.clock, localClock) > 0;

	if (!remoteWins && isSyncDirty()) {
		const pushed = await pushSnapshot({ store, force: true });
		return {
			applied: false,
			pushedInstead: pushed.pushed,
			reason: "local-newer",
		};
	}
	if (!remoteWins) {
		return { applied: false, reason: "local-newer" };
	}

	await applyRemoteEnvelope(remote, password, store);
	return { applied: true };
}

export async function listSyncHistory(
	store: SyncBlobStore = getSyncBlobStore(),
): Promise<SyncHistoryItem[]> {
	return store.listHistory();
}

export async function restoreSyncHistory(options: {
	filename: string;
	confirm: true;
	store?: SyncBlobStore;
}): Promise<PullResult> {
	if (options.confirm !== true) {
		throw new Error("confirm must be true to restore a history snapshot.");
	}
	const store = options.store ?? getSyncBlobStore();
	const password = getSyncPassphrase();
	if (!password) {
		throw new Error("Sync password is missing from Keychain.");
	}
	const envelope = await store.readHistory(options.filename);
	if (!envelope) {
		throw new Error("History snapshot was not found.");
	}
	await applyRemoteEnvelope(envelope, password, store, { markDirty: true });
	await pushSnapshot({ store, force: true });
	return { applied: true };
}

export async function runSyncTick(
	store: SyncBlobStore = getSyncBlobStore(),
): Promise<{ action: "push" | "pull" | "none" }> {
	const state = readSyncState();
	if (!state.enabled) {
		return { action: "none" };
	}
	if (shouldPushNow()) {
		await pushSnapshot({ store });
		return { action: "push" };
	}
	if (!isSyncDirty()) {
		await pullSnapshot({ store, automatic: true });
		return { action: "pull" };
	}
	return { action: "none" };
}

async function applyRemoteEnvelope(
	remote: EncryptedSyncFile,
	password: string,
	store: SyncBlobStore,
	options?: { markDirty?: boolean },
): Promise<void> {
	const plaintext = await decryptSyncPayload(remote, password);
	let parsed: unknown;
	try {
		parsed = JSON.parse(plaintext);
	} catch {
		throw new Error("Cloud vault payload is not valid JSON.");
	}
	const payload = parseSyncPayload(parsed);
	const local = readConfigRaw();
	const merged = mergeDeniedConfigKeys(payload.config, local);

	beginApplyingRemote();
	try {
		writeConfigRaw(merged);
		writeCredentials(payload.credentials as CredentialsFile);
	} finally {
		endApplyingRemote();
	}

	invalidateSettingsCache();
	clearModelListCache();

	const state = readSyncState();
	const next: SyncState = {
		...state,
		enabled: true,
		lastAckedContentHash: remote.contentHash,
		lastAckedLamport: remote.clock.lamport,
		lastAckedUtc: remote.clock.utc,
		lastPullAt: new Date().toISOString(),
		lastError: null,
		vaultPath: store.rootDir,
		lastWriterDeviceName: remote.clock.deviceName,
		lastWriterDeviceId: remote.clock.deviceId,
	};
	writeSyncState(next);
	if (options?.markDirty) {
		markSyncDirty();
	} else {
		clearSyncDirty();
	}
}

function ackRemoteClock(
	state: SyncState,
	remote: EncryptedSyncFile,
	store: SyncBlobStore,
): void {
	writeSyncState({
		...state,
		lastAckedContentHash: remote.contentHash,
		lastAckedLamport: remote.clock.lamport,
		lastAckedUtc: remote.clock.utc,
		lastPullAt: new Date().toISOString(),
		lastError: null,
		vaultPath: store.rootDir,
		lastWriterDeviceName: remote.clock.deviceName,
		lastWriterDeviceId: remote.clock.deviceId,
	});
}

function recordError(state: SyncState, message: string): void {
	writeSyncState({ ...state, lastError: message });
}

export function resolveSyncVaultDirForStatus(): string {
	return resolveSyncVaultDir();
}
