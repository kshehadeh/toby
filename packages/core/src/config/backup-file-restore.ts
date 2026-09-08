import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BackupArchiveReader } from "./backup-archive";
import {
	type BackupFileRoot,
	type FilesBackupManifest,
	isFilesBackupManifest,
} from "./backup-files";
import {
	PENDING_MANIFEST,
	type PendingRestoreManifest,
	isDatabaseBackupBundle,
	validateDatabaseBackupBundle,
	writeAtomic,
} from "./database-backup";
import {
	type CredentialsFile,
	resolveTobyDir,
	writeConfigRaw,
	writeCredentials,
} from "./index";

/**
 * Validates and stages a v3 backup archive for the next daemon startup.
 *
 * Staging never touches live data. Everything is decrypted, integrity-checked,
 * and written into a private pending directory first; the pending manifest is
 * written last as the commit point. If any step fails the pending directory is
 * removed and live state is untouched.
 */

const STAGING_CHUNK_BYTES = 1024 * 1024;

/** Rejects absolute paths, traversal, and empty components. */
export function isSafeRelativePath(value: string): boolean {
	if (
		!value ||
		value.startsWith("/") ||
		value.includes("\\") ||
		value.includes("\0")
	) {
		return false;
	}
	const parts = value.split("/");
	return parts.every(
		(part) => part.length > 0 && part !== "." && part !== "..",
	);
}

/** Stable folder keys are project ids (UUIDs) and recording ids (timestamps). */
export function isSafeEntryKey(value: string): boolean {
	return (
		value.length > 0 &&
		value.length <= 256 &&
		/^[a-zA-Z0-9._-]+$/.test(value) &&
		!value.startsWith(".")
	);
}

export interface StageArchiveRestoreOptions {
	/** Write settings + credentials after everything else has staged cleanly. */
	readonly applySettings?: {
		readonly config: Record<string, unknown>;
		readonly credentials: CredentialsFile | Record<string, unknown>;
	};
	/** Fail when the archive has no databases section (expected in every v3 archive). */
	readonly requireDatabases?: boolean;
}

export interface StageArchiveRestoreResult {
	readonly databasesStaged: boolean;
	readonly projectsStaged: boolean;
	readonly recordingsStaged: boolean;
}

/**
 * Stage databases, project files, and recordings from an archive for the next
 * daemon startup. Only validated data is committed via the pending manifest.
 */
export async function stageArchiveRestore(
	reader: BackupArchiveReader,
	options: StageArchiveRestoreOptions = {},
): Promise<StageArchiveRestoreResult> {
	const root = resolveTobyDir();
	const pendingDirName = `.pending-restore-${process.pid}-${Date.now()}`;
	const pendingDir = path.join(root, pendingDirName);
	fs.mkdirSync(pendingDir, { recursive: true, mode: 0o700 });
	let databasesStaged = false;
	let projectsStaged = false;
	let recordingsStaged = false;
	try {
		if (reader.hasSection("databases")) {
			const raw = await reader.readSection("databases");
			const bundle: unknown = JSON.parse(raw.toString("utf8"));
			if (!isDatabaseBackupBundle(bundle)) {
				throw new Error("Not a valid Toby database backup.");
			}
			const { chat, memory } = validateDatabaseBackupBundle(bundle);
			writeAtomic(path.join(pendingDir, "chat.sqlite"), chat);
			writeAtomic(path.join(pendingDir, "memory.sqlite"), memory);
			databasesStaged = true;
		} else if (options.requireDatabases) {
			throw new Error("Backup archive is missing its databases section.");
		}

		if (reader.hasSection("files-manifest")) {
			const raw = await reader.readSection("files-manifest");
			const manifest: unknown = JSON.parse(raw.toString("utf8"));
			if (!isFilesBackupManifest(manifest)) {
				throw new Error("Backup archive file manifest is invalid.");
			}
			const stagedRoots = await stageBackupFiles(reader, manifest, pendingDir);
			projectsStaged = stagedRoots.projects;
			recordingsStaged = stagedRoots.recordings;
		}

		if (options.applySettings) {
			writeConfigRaw(options.applySettings.config);
			writeCredentials(options.applySettings.credentials as CredentialsFile);
		}

		// Commit point: written last so an interrupted staging is never applied.
		const manifest: PendingRestoreManifest = {
			version: 2,
			pendingDir: pendingDirName,
			databases: databasesStaged,
			projects: projectsStaged,
			recordings: recordingsStaged,
		};
		writeAtomic(
			path.join(root, PENDING_MANIFEST),
			Buffer.from(JSON.stringify(manifest), "utf8"),
		);
	} catch (error) {
		fs.rmSync(pendingDir, { recursive: true, force: true });
		throw error;
	}
	return { databasesStaged, projectsStaged, recordingsStaged };
}

async function stageBackupFiles(
	reader: BackupArchiveReader,
	manifest: FilesBackupManifest,
	pendingDir: string,
): Promise<{ projects: boolean; recordings: boolean }> {
	const staged: Record<BackupFileRoot, boolean> = {
		projects: false,
		recordings: false,
	};
	for (const root of manifest.roots) {
		const sectionName = `${root}-files`;
		if (!reader.hasSection(sectionName)) {
			throw new Error(
				`Backup archive is missing the "${sectionName}" section.`,
			);
		}
		const destRoot = path.join(pendingDir, root);
		fs.mkdirSync(destRoot, { recursive: true, mode: 0o700 });
		staged[root] = true;
		const byteReader = new SectionByteReader(reader.sectionChunks(sectionName));
		for (const entry of manifest.entries) {
			if (entry.root !== root) continue;
			const dest = path.join(destRoot, entry.key, entry.path);
			if (!isSafeEntryKey(entry.key) || !isSafeRelativePath(entry.path)) {
				throw new Error("Backup archive contains an unsafe file path.");
			}
			if (entry.type === "dir") {
				fs.mkdirSync(dest, { recursive: true });
				continue;
			}
			fs.mkdirSync(path.dirname(dest), { recursive: true });
			await writeStagedFile(byteReader, entry, dest, root);
		}
		await byteReader.expectEnd();
	}
	return { projects: staged.projects, recordings: staged.recordings };
}

async function writeStagedFile(
	byteReader: SectionByteReader,
	entry: {
		key: string;
		path: string;
		size: number;
		sha256: string;
		mode: number;
	},
	dest: string,
	root: BackupFileRoot,
): Promise<void> {
	const hash = createHash("sha256");
	const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
	const outFd = fs.openSync(tmp, "w", 0o600);
	let remaining = entry.size;
	try {
		while (remaining > 0) {
			const chunk = await byteReader.readExact(
				Math.min(STAGING_CHUNK_BYTES, remaining),
			);
			hash.update(chunk);
			fs.writeSync(outFd, chunk);
			remaining -= chunk.length;
		}
	} finally {
		fs.closeSync(outFd);
	}
	const sha256 = hash.digest("hex");
	if (sha256 !== entry.sha256) {
		fs.unlinkSync(tmp);
		throw new Error(
			`Backup file "${root}/${entry.key}/${entry.path}" failed its integrity check.`,
		);
	}
	fs.renameSync(tmp, dest);
	try {
		fs.chmodSync(dest, entry.mode || 0o600);
	} catch {
		// Mode is best-effort; content integrity is what matters.
	}
}

/** Reads exact byte counts from a decrypted section stream. */
class SectionByteReader {
	private chunks: Buffer[] = [];
	private buffered = 0;
	private done = false;

	constructor(private readonly gen: AsyncGenerator<Buffer, void, unknown>) {}

	private async fill(): Promise<void> {
		if (this.done) return;
		const result = await this.gen.next();
		if (result.done) {
			this.done = true;
			return;
		}
		const buf = Buffer.from(result.value);
		this.chunks.push(buf);
		this.buffered += buf.length;
	}

	async readExact(n: number): Promise<Buffer> {
		if (n === 0) return Buffer.alloc(0);
		while (this.buffered < n) {
			if (this.done) {
				throw new Error("Backup file section ended early.");
			}
			await this.fill();
		}
		const first = this.chunks[0];
		if (first.length === n && this.chunks.length === 1) {
			this.chunks = [];
			this.buffered = 0;
			return first;
		}
		const out = Buffer.alloc(n);
		let filled = 0;
		while (filled < n) {
			const chunk = this.chunks[0];
			const take = Math.min(chunk.length, n - filled);
			chunk.copy(out, filled, 0, take);
			filled += take;
			if (take === chunk.length) {
				this.chunks.shift();
			} else {
				this.chunks[0] = chunk.subarray(take);
			}
			this.buffered -= take;
		}
		return out;
	}

	async expectEnd(): Promise<void> {
		if (this.buffered > 0) {
			throw new Error("Backup file section has unexpected trailing data.");
		}
		if (!this.done) {
			const result = await this.gen.next();
			if (!result.done) {
				throw new Error("Backup file section has unexpected trailing data.");
			}
			this.done = true;
		}
	}
}
