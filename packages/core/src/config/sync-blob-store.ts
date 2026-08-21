import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type SyncClock, compareSyncClock } from "./sync-clock";
import { type EncryptedSyncFile, isEncryptedSyncFile } from "./sync-crypto";

export const SYNC_HISTORY_LIMIT = 10;
export const SYNC_VAULT_FILENAME = "vault.json";

export const ICLOUD_DRIVE_RELATIVE =
	"Library/Mobile Documents/com~apple~CloudDocs/Toby/config-sync";

export interface SyncHistoryItem {
	filename: string;
	createdAt: string;
	clock: SyncClock;
	contentHash: string;
}

export interface SyncBlobStore {
	readCurrent(): Promise<EncryptedSyncFile | null>;
	writeCurrent(envelope: EncryptedSyncFile): Promise<void>;
	listHistory(): Promise<SyncHistoryItem[]>;
	readHistory(filename: string): Promise<EncryptedSyncFile | null>;
	deleteAll(): Promise<void>;
	readonly rootDir: string;
}

export function resolveSyncVaultDir(): string {
	const override = process.env.TOBY_SYNC_DIR?.trim();
	if (override) {
		return override;
	}
	return path.join(os.homedir(), ICLOUD_DRIVE_RELATIVE);
}

export function isICloudDriveFolderAvailable(): boolean {
	if (process.env.TOBY_SYNC_DIR?.trim()) {
		return true;
	}
	const cloudDocs = path.join(
		os.homedir(),
		"Library/Mobile Documents/com~apple~CloudDocs",
	);
	return fs.existsSync(cloudDocs);
}

export function createFilesystemSyncBlobStore(
	rootDir = resolveSyncVaultDir(),
): SyncBlobStore {
	return new FilesystemSyncBlobStore(rootDir);
}

class FilesystemSyncBlobStore implements SyncBlobStore {
	constructor(readonly rootDir: string) {}

	private vaultPath(): string {
		return path.join(this.rootDir, SYNC_VAULT_FILENAME);
	}

	private historyDir(): string {
		return path.join(this.rootDir, "history");
	}

	async readCurrent(): Promise<EncryptedSyncFile | null> {
		const candidates = this.listVaultCandidates();
		let best: EncryptedSyncFile | null = null;
		for (const filePath of candidates) {
			const parsed = readEnvelopeFile(filePath);
			if (!parsed) {
				continue;
			}
			if (!best || compareSyncClock(parsed.clock, best.clock) > 0) {
				best = parsed;
			}
		}
		return best;
	}

	async writeCurrent(envelope: EncryptedSyncFile): Promise<void> {
		fs.mkdirSync(this.historyDir(), { recursive: true });
		const vaultPath = this.vaultPath();
		if (fs.existsSync(vaultPath)) {
			const previous = readEnvelopeFile(vaultPath);
			if (previous) {
				const historyName = historyFilenameFor(previous);
				atomicWriteJson(path.join(this.historyDir(), historyName), previous);
			}
		}
		atomicWriteJson(vaultPath, envelope);
		this.pruneHistory();
	}

	async listHistory(): Promise<SyncHistoryItem[]> {
		const dir = this.historyDir();
		if (!fs.existsSync(dir)) {
			return [];
		}
		const items: SyncHistoryItem[] = [];
		for (const name of fs.readdirSync(dir)) {
			if (!name.endsWith(".json")) {
				continue;
			}
			const parsed = readEnvelopeFile(path.join(dir, name));
			if (!parsed) {
				continue;
			}
			items.push({
				filename: name,
				createdAt: parsed.createdAt,
				clock: parsed.clock,
				contentHash: parsed.contentHash,
			});
		}
		items.sort((a, b) => compareSyncClock(b.clock, a.clock));
		return items;
	}

	async readHistory(filename: string): Promise<EncryptedSyncFile | null> {
		const safe = path.basename(filename);
		if (safe !== filename || !safe.endsWith(".json")) {
			throw new Error("Invalid history filename.");
		}
		return readEnvelopeFile(path.join(this.historyDir(), safe));
	}

	async deleteAll(): Promise<void> {
		if (fs.existsSync(this.rootDir)) {
			fs.rmSync(this.rootDir, { recursive: true, force: true });
		}
	}

	private listVaultCandidates(): string[] {
		if (!fs.existsSync(this.rootDir)) {
			return [];
		}
		const names = fs.readdirSync(this.rootDir);
		const matches: string[] = [];
		for (const name of names) {
			if (name === "history" || !name.endsWith(".json")) {
				continue;
			}
			// Current vault plus iCloud conflict copies ("vault 2.json").
			if (name === SYNC_VAULT_FILENAME || name.startsWith("vault")) {
				matches.push(path.join(this.rootDir, name));
			}
		}
		return matches;
	}

	private pruneHistory(): void {
		const dir = this.historyDir();
		if (!fs.existsSync(dir)) {
			return;
		}
		const files = fs
			.readdirSync(dir)
			.filter((name) => name.endsWith(".json"))
			.map((name) => {
				const filePath = path.join(dir, name);
				const parsed = readEnvelopeFile(filePath);
				return { name, filePath, clock: parsed?.clock ?? null };
			})
			.sort((a, b) => {
				if (a.clock && b.clock) {
					return compareSyncClock(b.clock, a.clock);
				}
				if (a.clock) return -1;
				if (b.clock) return 1;
				return b.name.localeCompare(a.name);
			});
		for (const extra of files.slice(SYNC_HISTORY_LIMIT)) {
			try {
				fs.unlinkSync(extra.filePath);
			} catch {
				// Best-effort prune.
			}
		}
	}
}

function historyFilenameFor(envelope: EncryptedSyncFile): string {
	const stamp = envelope.clock.utc.replace(/[:.]/g, "-");
	return `${stamp}-l${envelope.clock.lamport}.json`;
}

function readEnvelopeFile(filePath: string): EncryptedSyncFile | null {
	if (!fs.existsSync(filePath)) {
		return null;
	}
	try {
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
		return isEncryptedSyncFile(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function atomicWriteJson(filePath: string, value: unknown): void {
	const dir = path.dirname(filePath);
	fs.mkdirSync(dir, { recursive: true });
	const tmp = path.join(
		dir,
		`.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
	);
	fs.writeFileSync(tmp, JSON.stringify(value, null, 2), {
		encoding: "utf-8",
		mode: 0o600,
	});
	fs.renameSync(tmp, filePath);
}
