import fs from "node:fs";
import path from "node:path";
import { resolveListenRecordingsDir } from "../listen/recordings";
import { type Project, listProjects } from "../projects";
import type { BackupArchiveWriter } from "./backup-archive";

/**
 * Captures Toby-managed file trees (project folders and saved recordings) into
 * encrypted archive sections. The manifest is written by the caller after the
 * file sections so entry order always matches byte order in the streams.
 */

export type BackupFileRoot = "projects" | "recordings";

export interface BackupFileEntry {
	readonly type: "file" | "dir";
	readonly root: BackupFileRoot;
	/** Stable folder key: project id for projects, recording id for recordings. */
	readonly key: string;
	/** Path relative to the key's folder. */
	readonly path: string;
	/** Byte size (files only; 0 for directories). */
	readonly size: number;
	/** SHA-256 of the plaintext bytes (files only). */
	readonly sha256: string;
	/** Permission bits to restore (files only). */
	readonly mode: number;
}

export interface FilesBackupManifest {
	readonly version: 1;
	/** Roots captured in this archive. Presence of a root means restore replaces it. */
	readonly roots: readonly BackupFileRoot[];
	/** Entries in the exact order their bytes appear in the `${root}-files` sections. */
	readonly entries: readonly BackupFileEntry[];
	/** Human-readable notes for skipped items (symlinks, unreadable files). */
	readonly skipped: readonly string[];
}

const FILE_ROOTS: readonly BackupFileRoot[] = ["projects", "recordings"];

/** Structural + safety validation for a file manifest parsed from an archive. */
export function isFilesBackupManifest(
	value: unknown,
): value is FilesBackupManifest {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	if (
		record.version !== 1 ||
		!Array.isArray(record.roots) ||
		!Array.isArray(record.entries) ||
		!Array.isArray(record.skipped)
	) {
		return false;
	}
	const roots = record.roots as unknown[];
	if (
		roots.length === 0 ||
		roots.length > 2 ||
		new Set(roots).size !== roots.length ||
		!roots.every((root) => FILE_ROOTS.includes(root as BackupFileRoot))
	) {
		return false;
	}
	for (const entry of record.entries as unknown[]) {
		if (typeof entry !== "object" || entry === null) return false;
		const e = entry as Record<string, unknown>;
		if (
			(e.type !== "file" && e.type !== "dir") ||
			!FILE_ROOTS.includes(e.root as BackupFileRoot) ||
			typeof e.key !== "string" ||
			typeof e.path !== "string" ||
			typeof e.size !== "number" ||
			!Number.isSafeInteger(e.size) ||
			e.size < 0 ||
			typeof e.mode !== "number"
		) {
			return false;
		}
		if (e.type === "file") {
			if (typeof e.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(e.sha256)) {
				return false;
			}
		} else if (e.size !== 0) {
			return false;
		}
	}
	return true;
}

const MAX_WALK_DEPTH = 64;
const RECORDINGS_TEMP_DIR = ".tmp";

function noteSkipped(
	manifest: { skipped: string[] },
	root: BackupFileRoot,
	key: string,
	relPath: string,
	reason: string,
): void {
	manifest.skipped.push(`${root}/${key}/${relPath} (${reason})`);
}

/** Deterministic name order so archive byte layout is reproducible. */
function compareNames(a: fs.Dirent, b: fs.Dirent): number {
	if (a.name < b.name) return -1;
	if (a.name > b.name) return 1;
	return 0;
}

async function appendTree(
	writer: BackupArchiveWriter,
	root: BackupFileRoot,
	key: string,
	dir: string,
	manifest: { entries: BackupFileEntry[]; skipped: string[] },
	rel = "",
	depth = 0,
): Promise<void> {
	if (depth > MAX_WALK_DEPTH) {
		noteSkipped(manifest, root, key, rel || ".", "directory tree too deep");
		return;
	}
	let dirents: fs.Dirent[];
	try {
		dirents = fs.readdirSync(dir, { withFileTypes: true }).sort(compareNames);
	} catch {
		noteSkipped(manifest, root, key, rel || ".", "directory could not be read");
		return;
	}
	for (const dirent of dirents) {
		const relPath = rel ? `${rel}/${dirent.name}` : dirent.name;
		const absPath = path.join(dir, dirent.name);
		let stat: fs.Stats;
		try {
			stat = fs.lstatSync(absPath);
		} catch {
			noteSkipped(manifest, root, key, relPath, "could not be inspected");
			continue;
		}
		if (stat.isSymbolicLink()) {
			noteSkipped(manifest, root, key, relPath, "symbolic link");
			continue;
		}
		if (stat.isDirectory()) {
			manifest.entries.push({
				type: "dir",
				root,
				key,
				path: relPath,
				size: 0,
				sha256: "",
				mode: stat.mode & 0o777,
			});
			await appendTree(
				writer,
				root,
				key,
				absPath,
				manifest,
				relPath,
				depth + 1,
			);
			continue;
		}
		if (!stat.isFile()) {
			noteSkipped(manifest, root, key, relPath, "special file");
			continue;
		}
		try {
			const { size, sha256 } = await writer.appendFileToSection(absPath);
			manifest.entries.push({
				type: "file",
				root,
				key,
				path: relPath,
				size,
				sha256,
				mode: stat.mode & 0o777,
			});
		} catch {
			noteSkipped(manifest, root, key, relPath, "file could not be read");
		}
	}
}

/**
 * Append `projects-files` and `recordings-files` sections plus their manifest.
 * Project folders are captured per stable project id; recordings are captured
 * per recording directory. The returned manifest must be written by the caller
 * as the `files-manifest` section after the file sections are complete.
 */
export async function appendFileSectionsToArchive(
	writer: BackupArchiveWriter,
): Promise<FilesBackupManifest> {
	const manifest: {
		version: 1;
		roots: BackupFileRoot[];
		entries: BackupFileEntry[];
		skipped: string[];
	} = {
		version: 1,
		roots: ["projects", "recordings"],
		entries: [],
		skipped: [],
	};

	writer.beginSection("projects-files");
	const seenFolders = new Set<string>();
	for (const project of listProjects()) {
		if (seenFolders.has(project.folderPath)) continue;
		seenFolders.add(project.folderPath);
		await appendTree(
			writer,
			"projects",
			project.id,
			project.folderPath,
			manifest,
		);
	}
	await writer.endSection();

	writer.beginSection("recordings-files");
	const recordingsRoot = resolveListenRecordingsDir();
	if (fs.existsSync(recordingsRoot)) {
		const dirents = fs
			.readdirSync(recordingsRoot, { withFileTypes: true })
			.filter(
				(entry) => entry.isDirectory() && entry.name !== RECORDINGS_TEMP_DIR,
			)
			.sort(compareNames);
		for (const dirent of dirents) {
			await appendTree(
				writer,
				"recordings",
				dirent.name,
				path.join(recordingsRoot, dirent.name),
				manifest,
			);
		}
	}
	await writer.endSection();

	return manifest;
}
