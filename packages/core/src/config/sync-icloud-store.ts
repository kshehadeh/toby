import {
	isNativeServerAlive,
	nativeAppRequest,
	resolveNativePort,
} from "../native-app/client";
import {
	type SyncBlobStore,
	type SyncHistoryItem,
	createFilesystemSyncBlobStore,
	resolveSyncVaultDir,
} from "./sync-blob-store";
import { isSyncClock } from "./sync-clock";
import { type EncryptedSyncFile, isEncryptedSyncFile } from "./sync-crypto";

/**
 * Prefers Toby.app coordinated iCloud I/O when the native server is already
 * running. Falls back to direct filesystem writes (CloudDocs / TOBY_SYNC_DIR)
 * so the daemon still works without launching the app on every tick.
 */
export function createNativeAwareSyncBlobStore(
	rootDir = resolveSyncVaultDir(),
): SyncBlobStore {
	return new NativeAwareSyncBlobStore(createFilesystemSyncBlobStore(rootDir));
}

class NativeAwareSyncBlobStore implements SyncBlobStore {
	constructor(private readonly fallback: SyncBlobStore) {}

	get rootDir(): string {
		return this.fallback.rootDir;
	}

	async readCurrent(): Promise<EncryptedSyncFile | null> {
		if (await nativeAlive()) {
			await nativeAppRequest("icloud/ensure", {
				method: "POST",
				body: { filename: "vault.json" },
				launch: false,
			});
			const res = await nativeAppRequest("icloud/read", {
				method: "POST",
				body: { filename: "vault.json" },
				launch: false,
			});
			if (res.ok) {
				return envelopeFromData(res.data);
			}
		}
		return this.fallback.readCurrent();
	}

	async writeCurrent(envelope: EncryptedSyncFile): Promise<void> {
		if (await nativeAlive()) {
			const res = await nativeAppRequest("icloud/write", {
				method: "POST",
				body: { envelope: envelope as unknown as Record<string, unknown> },
				launch: false,
			});
			if (res.ok) {
				return;
			}
		}
		await this.fallback.writeCurrent(envelope);
	}

	async listHistory(): Promise<SyncHistoryItem[]> {
		return this.fallback.listHistory();
	}

	async readHistory(filename: string): Promise<EncryptedSyncFile | null> {
		if (await nativeAlive()) {
			const res = await nativeAppRequest("icloud/read", {
				method: "POST",
				body: { filename },
				launch: false,
			});
			if (res.ok) {
				return envelopeFromData(res.data);
			}
		}
		return this.fallback.readHistory(filename);
	}

	async deleteAll(): Promise<void> {
		if (await nativeAlive()) {
			const res = await nativeAppRequest("icloud/delete", {
				method: "POST",
				launch: false,
			});
			if (res.ok) {
				return;
			}
		}
		await this.fallback.deleteAll();
	}
}

export async function nativeICloudStatus(): Promise<{
	available: boolean;
	vaultPath?: string;
} | null> {
	if (!(await nativeAlive())) {
		return null;
	}
	const res = await nativeAppRequest("icloud/status", {
		method: "GET",
		launch: false,
	});
	if (!res.ok || !res.data) {
		return null;
	}
	return {
		available: res.data.available === true,
		vaultPath:
			typeof res.data.vaultPath === "string" ? res.data.vaultPath : undefined,
	};
}

async function nativeAlive(): Promise<boolean> {
	const port = resolveNativePort();
	if (!port) {
		return false;
	}
	return isNativeServerAlive(port);
}

function envelopeFromData(
	data: Record<string, unknown> | undefined,
): EncryptedSyncFile | null {
	if (!data || data.envelope == null) {
		return null;
	}
	const envelope = data.envelope;
	if (!isEncryptedSyncFile(envelope)) {
		return null;
	}
	if (!isSyncClock(envelope.clock)) {
		return null;
	}
	return envelope;
}
