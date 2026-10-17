import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ensureTobyDir, getGeneratedFilesDir } from "../config/index";
import type { Project } from "../projects/index";

/** Text file extensions `writeTextFile` is allowed to create. */
export const WRITE_TEXT_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
	".md",
	".markdown",
	".txt",
	".text",
	".json",
	".yaml",
	".yml",
	".csv",
	".tsv",
	".log",
	".xml",
	".html",
	".rst",
]);

export type WriteTextFileLocation = "context" | "outputs";

interface ResolveWriteTargetResult {
	readonly ok: boolean;
	readonly error?: string;
	readonly absPath?: string;
	readonly baseDir?: string;
	/** Human-readable label for the base location. */
	readonly baseLabel?: string;
}

/**
 * Resolve and validate the absolute target path for `writeTextFile`. Rejects
 * absolute inputs, parent-directory traversal, and paths that escape the base
 * directory (active project context/root, or the generated-files fallback).
 */
export function resolveWriteTextFileTarget(params: {
	readonly inputPath: string;
	readonly location: WriteTextFileLocation;
	readonly project?: Project | null;
}): ResolveWriteTargetResult {
	const raw = params.inputPath.trim();
	if (!raw) {
		return { ok: false, error: "path must not be empty." };
	}
	if (path.isAbsolute(raw)) {
		return {
			ok: false,
			error: "path must be relative (absolute paths are not allowed).",
		};
	}
	const normalized = path.normalize(raw);
	if (
		normalized === ".." ||
		normalized.startsWith(`..${path.sep}`) ||
		normalized.split(path.sep).includes("..")
	) {
		return {
			ok: false,
			error: "path must not traverse outside the base directory.",
		};
	}

	let baseDir: string;
	let baseLabel: string;
	if (params.project) {
		switch (params.location) {
			case "outputs":
				baseDir = params.project.outputsDir;
				baseLabel = `project "${params.project.name}" outputs`;
				break;
			default:
				baseDir =
					(params.project as { folderPath?: string }).folderPath ??
					params.project.dir;
				baseLabel = `project "${params.project.name}" folder`;
				break;
		}
	} else {
		baseDir = getGeneratedFilesDir();
		baseLabel = "~/.toby/generated-files";
	}

	const absPath = path.resolve(baseDir, normalized);
	const relCheck = path.relative(baseDir, absPath);
	if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
		return { ok: false, error: "Resolved path escapes the base directory." };
	}

	const ext = path.extname(absPath).toLowerCase();
	if (!ext) {
		return { ok: false, error: "path must include a file extension." };
	}
	if (!WRITE_TEXT_FILE_EXTENSIONS.has(ext)) {
		return {
			ok: false,
			error: `Unsupported file type "${ext}". Allowed: ${[...WRITE_TEXT_FILE_EXTENSIONS].join(", ")}.`,
		};
	}

	return { ok: true, absPath, baseDir, baseLabel };
}

/**
 * Markdown the model should paste into its reply so the chat UI can offer
 * Download / Open for a file written by `writeTextFile`.
 */
export function markdownDownloadLinkForWrittenFile(absPath: string): string {
	const name = path.basename(absPath);
	return `[Download ${name}](${pathToFileURL(absPath).href})`;
}

export function writeTextFileSuccessPayload(params: {
	readonly absPath: string;
	readonly dryRun: boolean;
	readonly created: boolean;
	readonly message: string;
}) {
	return {
		ok: true as const,
		dryRun: params.dryRun,
		path: params.absPath,
		fileUrl: pathToFileURL(params.absPath).href,
		markdown: markdownDownloadLinkForWrittenFile(params.absPath),
		created: params.created,
		message: params.message,
	};
}

/**
 * Write a UTF-8 text file into a project (or the generated-files fallback when
 * `project` is null). Shared by `writeTextFile` and `saveToTobyProject`.
 */
export function executeWriteTextFile(params: {
	readonly inputPath: string;
	readonly content: string;
	readonly location: WriteTextFileLocation;
	readonly overwrite: boolean;
	readonly project: Project | null;
	readonly dryRun: boolean;
	/** Mutated on successful writes (and dry-run previews). */
	readonly appliedActions: string[];
}) {
	if (params.content.includes("\u0000")) {
		return {
			ok: false as const,
			error: "content appears to be binary (contains NUL bytes).",
		};
	}
	const resolved = resolveWriteTextFileTarget({
		inputPath: params.inputPath,
		location: params.location,
		project: params.project,
	});
	if (!resolved.ok || !resolved.absPath) {
		return {
			ok: false as const,
			error: resolved.error ?? "Could not resolve target path.",
		};
	}
	const targetFile = resolved.absPath;

	let alreadyExists = false;
	try {
		const stat = fs.lstatSync(targetFile);
		alreadyExists = true;
		if (stat.isSymbolicLink()) {
			return {
				ok: false as const,
				error: "Refusing to write through a symlink.",
			};
		}
		if (stat.isDirectory()) {
			return {
				ok: false as const,
				error: "Target path is a directory.",
			};
		}
	} catch {
		alreadyExists = false;
	}

	if (alreadyExists && !params.overwrite) {
		return {
			ok: false as const,
			error: `File already exists at ${targetFile}. Set overwrite=true to replace it.`,
		};
	}

	if (params.dryRun) {
		const verb = alreadyExists ? "update" : "write";
		const msg = `[dry-run] Would ${verb} ${targetFile}`;
		params.appliedActions.push(msg);
		return writeTextFileSuccessPayload({
			absPath: targetFile,
			dryRun: true,
			created: !alreadyExists,
			message: msg,
		});
	}

	try {
		ensureTobyDir();
		fs.mkdirSync(path.dirname(targetFile), { recursive: true });
		const normalizedContent = params.content.endsWith("\n")
			? params.content
			: `${params.content}\n`;
		fs.writeFileSync(targetFile, normalizedContent, "utf-8");
	} catch (e) {
		return {
			ok: false as const,
			error: e instanceof Error ? e.message : "Failed to write text file.",
		};
	}

	const msg = alreadyExists
		? `Updated ${targetFile}`
		: `Wrote ${targetFile} (${resolved.baseLabel})`;
	params.appliedActions.push(msg);
	return writeTextFileSuccessPayload({
		absPath: targetFile,
		dryRun: false,
		created: !alreadyExists,
		message: msg,
	});
}
