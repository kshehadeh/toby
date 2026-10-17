import fs from "node:fs";
import path from "node:path";
import { log } from "../logging/chat-log";
import { listProjectContextFiles, listProjects } from "../projects/index";
import { getDb } from "../session-store";
import {
	type AddLibraryBytesInput,
	catalogLibraryBytes,
} from "./library-service";
import {
	getCatalogSeen,
	isLibraryWorkCurrent,
	libraryBackgroundEpoch,
	upsertCatalogSeen,
} from "./library-store";
import type { LibraryReferenceInput } from "./types";

const SYNC_INTERVAL_MS = 30_000;

let catalogSync: Promise<void> | null = null;
let lastCatalogSyncAt = 0;

export function isLibraryCatalogSyncing(): boolean {
	return catalogSync !== null;
}

/**
 * Scan chats and projects for files the library does not know about yet.
 * Safe to call often: unchanged files are skipped, and only one scan runs.
 */
export function scheduleLibraryCatalogSync(opts?: {
	readonly force?: boolean;
}): void {
	if (catalogSync) return;
	if (
		!opts?.force &&
		lastCatalogSyncAt > 0 &&
		Date.now() - lastCatalogSyncAt < SYNC_INTERVAL_MS
	) {
		return;
	}
	catalogSync = syncLibraryCatalog()
		.catch((error) => {
			log("warn", "general", "library_catalog_sync_failed", {
				reason: error instanceof Error ? error.message : String(error),
			});
		})
		.finally(() => {
			lastCatalogSyncAt = Date.now();
			catalogSync = null;
		});
}

export async function syncLibraryCatalog(): Promise<void> {
	const epoch = libraryBackgroundEpoch();
	const tobyDir = process.env.TOBY_DIR;
	const alive = () => isLibraryWorkCurrent(epoch, tobyDir);
	await syncProjectFiles(alive);
	if (!alive()) return;
	await syncChatAttachments(alive);
}

/** Record the attachments on a chat turn. Failures stay out of the turn. */
export async function registerChatAttachments(input: {
	readonly sessionId: string;
	readonly attachments: readonly {
		readonly filename: string;
		readonly mediaType: string;
		readonly dataBase64: string;
	}[];
}): Promise<void> {
	if (input.attachments.length === 0) return;
	const label = chatSessionTitle(input.sessionId);
	for (const attachment of input.attachments) {
		try {
			const bytes = Buffer.from(attachment.dataBase64, "base64");
			await catalogLibraryBytes({
				filename: attachment.filename,
				bytes,
				mediaType: attachment.mediaType,
				source: "chat",
				reference: {
					kind: "chat",
					sessionId: input.sessionId,
					label,
					detail: attachment.filename,
				},
			});
		} catch (error) {
			log("warn", "general", "library_catalog_skipped", {
				filename: attachment.filename,
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

/** Record a file that was written into a project folder. */
export async function registerProjectFile(input: {
	readonly projectId: string;
	readonly projectName: string;
	readonly relativePath: string;
	readonly filename: string;
	readonly bytes: Uint8Array;
	readonly mediaType?: string;
}): Promise<boolean> {
	const relativePath = normalizeRelativePath(input.relativePath);
	if (!relativePath || !isCatalogedProjectPath(relativePath)) return false;
	try {
		await catalogLibraryBytes({
			filename: input.filename,
			bytes: input.bytes,
			mediaType: input.mediaType,
			source: "project",
			reference: projectReference(
				input.projectId,
				input.projectName,
				relativePath,
			),
		});
		return true;
	} catch (error) {
		log("warn", "general", "library_catalog_skipped", {
			filename: input.filename,
			reason: error instanceof Error ? error.message : String(error),
		});
		return false;
	}
}

function projectReference(
	projectId: string,
	projectName: string,
	relativePath: string,
): LibraryReferenceInput {
	const label = projectName.trim() || "Project";
	return {
		kind: "project",
		projectId,
		label,
		detail: relativePath,
	};
}

/** Skip project instructions and skill files. Those have their own browsers. */
export function isCatalogedProjectPath(relativePath: string): boolean {
	const normalized = normalizeRelativePath(relativePath);
	if (!normalized || normalized === "AGENTS.md") return false;
	if (normalized.startsWith(".agent/")) return false;
	if (normalized.startsWith("skills/")) return false;
	if (normalized.split("/").includes("node_modules")) return false;
	return true;
}

async function syncProjectFiles(alive: () => boolean): Promise<void> {
	for (const project of listProjects()) {
		if (!alive()) return;
		let relativePaths: string[] = [];
		try {
			relativePaths = listProjectContextFiles(project);
		} catch (error) {
			log("warn", "general", "library_catalog_skipped", {
				projectId: project.id,
				reason: error instanceof Error ? error.message : String(error),
			});
			continue;
		}
		for (const relativePath of relativePaths) {
			if (!alive()) return;
			if (!isCatalogedProjectPath(relativePath)) continue;
			await catalogProjectPath(
				project.id,
				project.name,
				project.folderPath,
				relativePath,
			);
		}
	}
}

async function catalogProjectPath(
	projectId: string,
	projectName: string,
	folderPath: string,
	relativePath: string,
): Promise<void> {
	const absPath = path.join(folderPath, relativePath);
	let stat: fs.Stats;
	try {
		stat = fs.lstatSync(absPath);
	} catch {
		return;
	}
	if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) return;
	const originKey = `project:${projectId}:${relativePath}`;
	const fingerprint = `${stat.size}:${Math.round(stat.mtimeMs)}`;
	if (getCatalogSeen(originKey) === fingerprint) return;
	let bytes: Buffer;
	try {
		bytes = fs.readFileSync(absPath);
	} catch (error) {
		log("warn", "general", "library_catalog_skipped", {
			path: relativePath,
			reason: error instanceof Error ? error.message : String(error),
		});
		return;
	}
	const saved = await registerProjectFile({
		projectId,
		projectName,
		relativePath,
		filename: path.basename(relativePath),
		bytes,
	});
	if (saved) upsertCatalogSeen(originKey, fingerprint);
}

type TranscriptAttachmentRow = {
	sessionId: string;
	idx: number;
	text: string;
	name: string;
};

async function syncChatAttachments(alive: () => boolean): Promise<void> {
	let rows: TranscriptAttachmentRow[] = [];
	try {
		const db = getDb();
		rows = db
			.query(
				`SELECT t.session_id AS sessionId, t.idx AS idx, t.text AS text, s.name AS name
         FROM chat_session_transcript t
         JOIN chat_sessions s ON s.id = t.session_id
         WHERE t.kind = 'user' AND instr(t.text, '"attachments"') > 0`,
			)
			.all() as TranscriptAttachmentRow[];
	} catch (error) {
		log("warn", "general", "library_catalog_sync_failed", {
			reason: error instanceof Error ? error.message : String(error),
		});
		return;
	}
	for (const row of rows) {
		if (!alive()) return;
		const originKey = `chat:${row.sessionId}:${row.idx}`;
		const fingerprint = String(row.text.length);
		if (getCatalogSeen(originKey) === fingerprint) continue;
		const attachments = parseStoredAttachments(row.text);
		if (attachments.length === 0) {
			upsertCatalogSeen(originKey, fingerprint);
			continue;
		}
		const label = row.name.trim() || "Chat";
		let saved = true;
		for (const attachment of attachments) {
			const input: AddLibraryBytesInput = {
				filename: attachment.filename,
				bytes: Buffer.from(attachment.dataBase64, "base64"),
				mediaType: attachment.mediaType,
				source: "chat",
				reference: {
					kind: "chat",
					sessionId: row.sessionId,
					label,
					detail: attachment.filename,
				},
			};
			try {
				await catalogLibraryBytes(input);
			} catch (error) {
				saved = false;
				log("warn", "general", "library_catalog_skipped", {
					filename: attachment.filename,
					reason: error instanceof Error ? error.message : String(error),
				});
			}
		}
		if (saved) upsertCatalogSeen(originKey, fingerprint);
	}
}

function parseStoredAttachments(text: string): Array<{
	filename: string;
	mediaType: string;
	dataBase64: string;
}> {
	if (!text.startsWith("{")) return [];
	try {
		const parsed = JSON.parse(text) as { attachments?: unknown };
		if (!Array.isArray(parsed.attachments)) return [];
		const attachments: Array<{
			filename: string;
			mediaType: string;
			dataBase64: string;
		}> = [];
		for (const entry of parsed.attachments) {
			if (!entry || typeof entry !== "object") continue;
			const record = entry as Record<string, unknown>;
			if (
				typeof record.filename !== "string" ||
				typeof record.mediaType !== "string" ||
				typeof record.dataBase64 !== "string" ||
				record.filename.trim().length === 0 ||
				record.dataBase64.length === 0
			) {
				continue;
			}
			attachments.push({
				filename: record.filename,
				mediaType: record.mediaType,
				dataBase64: record.dataBase64,
			});
		}
		return attachments;
	} catch {
		return [];
	}
}

function chatSessionTitle(sessionId: string): string {
	try {
		const row = getDb()
			.query("SELECT name FROM chat_sessions WHERE id = $id")
			.get({ $id: sessionId }) as { name: string } | undefined;
		const name = row?.name?.trim();
		return name && name.length > 0 ? name : "Chat";
	} catch {
		return "Chat";
	}
}

function normalizeRelativePath(relativePath: string): string {
	return relativePath.split(path.sep).join("/").replace(/^\.\//, "");
}
