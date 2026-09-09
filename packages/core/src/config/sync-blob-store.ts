import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type SyncClock, compareSyncClock } from "./sync-clock";
import { type EncryptedSyncFile, isEncryptedSyncFile } from "./sync-crypto";

export const SYNC_HISTORY_LIMIT = 3;
export const SYNC_VAULT_FILENAME = "settings.json";
export const SYNC_SETTINGS_HISTORY_DIR = "settings-history";
export const SYNC_DATA_BACKUPS_DIR = "data-backups";

export const ICLOUD_DRIVE_RELATIVE =
	"Library/Mobile Documents/com~apple~CloudDocs/Toby/sync";

export interface SyncHistoryItem {
	filename: string;
	createdAt: string;
	clock: SyncClock;
	contentHash: string;
	path: string;
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
	return new FilesystemSyncBlobStore(migrateLegacySyncLayout(rootDir));
}

const LEGACY_VAULT_DIR = "config-sync";
const LEGACY_VAULT_FILENAME = "vault.json";
const LEGACY_HISTORY_DIR = "history";
const LEGACY_DATA_BACKUPS_DIR = "database-backups";

/**
 * Rename the previous on-disk layout in place:
 * `Toby/config-sync/vault.json|history|database-backups`
 * → `Toby/sync/settings.json|settings-history|data-backups`.
 */
export function migrateLegacySyncLayout(rootDir: string): string {
	const resolved = path.resolve(rootDir);
	const parent = path.dirname(resolved);
	const dest =
		path.basename(resolved) === LEGACY_VAULT_DIR
			? path.join(parent, "sync")
			: resolved;
	const legacySibling = path.join(parent, LEGACY_VAULT_DIR);

	let dir = dest;
	if (
		path.basename(dest) === "sync" &&
		!fs.existsSync(dest) &&
		fs.existsSync(legacySibling)
	) {
		fs.renameSync(legacySibling, dest);
		dir = dest;
	} else if (
		path.basename(resolved) === LEGACY_VAULT_DIR &&
		fs.existsSync(resolved)
	) {
		if (!fs.existsSync(dest)) {
			fs.renameSync(resolved, dest);
		}
		dir = fs.existsSync(dest) ? dest : resolved;
	}

	migrateLegacySyncContents(dir);
	return dir;
}

function migrateLegacySyncContents(dir: string): void {
	if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
		return;
	}
	renameEntry(dir, LEGACY_VAULT_FILENAME, SYNC_VAULT_FILENAME);
	renameEntry(dir, LEGACY_HISTORY_DIR, SYNC_SETTINGS_HISTORY_DIR);
	renameEntry(dir, LEGACY_DATA_BACKUPS_DIR, SYNC_DATA_BACKUPS_DIR);
	for (const name of fs.readdirSync(dir)) {
		if (
			name.startsWith("vault") &&
			name.endsWith(".json") &&
			name !== LEGACY_VAULT_FILENAME
		) {
			renameEntry(dir, name, name.replace(/^vault/, "settings"));
		}
	}
}

function renameEntry(dir: string, fromName: string, toName: string): void {
	if (fromName === toName) return;
	const from = path.join(dir, fromName);
	const to = path.join(dir, toName);
	if (!fs.existsSync(from) || fs.existsSync(to)) return;
	fs.renameSync(from, to);
}

class FilesystemSyncBlobStore implements SyncBlobStore {
	constructor(readonly rootDir: string) {}

	private vaultPath(): string {
		return path.join(this.rootDir, SYNC_VAULT_FILENAME);
	}

	private historyDir(): string {
		return path.join(this.rootDir, SYNC_SETTINGS_HISTORY_DIR);
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
		this.pruneHistory();
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
				path: path.join(dir, name),
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
			if (name === SYNC_SETTINGS_HISTORY_DIR || !name.endsWith(".json")) {
				continue;
			}
			// Current settings file plus iCloud conflict copies ("settings 2.json").
			if (name === SYNC_VAULT_FILENAME || name.startsWith("settings")) {
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
