import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { GatewayFundsError } from "../ai/gateway-funds";
import { log } from "../logging/chat-log";
import { extractKeywords } from "../memory/keywords";
import {
	resolveLibraryEmbedder,
	semanticLibraryHits,
	storeLibraryEmbedding,
} from "./embeddings";
import {
	extractLibraryText,
	libraryItemAbsolutePath,
	libraryItemDir,
	readExtractedText,
	writeExtractedText,
} from "./extract";
import * as store from "./library-store";
import {
	LIBRARY_MAX_BYTES,
	detectLibraryMediaType,
	isAcceptedLibraryMediaType,
	sanitizeLibraryFilename,
	titleFromFilename,
} from "./media";
import { summarizeLibraryItem } from "./summarize";
import type {
	LibraryItem,
	LibraryItemSource,
	LibraryOpenResult,
} from "./types";

export class LibraryError extends Error {
	readonly status: number;

	constructor(message: string, status = 400) {
		super(message);
		this.name = "LibraryError";
		this.status = status;
	}
}

function contentHash(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function assertSafeRelativePath(relativePath: string): void {
	if (
		relativePath.includes("..") ||
		path.isAbsolute(relativePath) ||
		relativePath.includes("\0")
	) {
		throw new LibraryError("Unsafe library path.");
	}
}

export function listLibraryItems(opts?: {
	readonly limit?: number;
	readonly offset?: number;
}): LibraryItem[] {
	return store.listItems(opts);
}

export function countLibraryItems(): number {
	return store.countItems();
}

export function getLibraryItem(id: string): LibraryItem | null {
	return store.getItem(id);
}

export async function searchLibrary(query: string): Promise<LibraryItem[]> {
	const trimmed = query.trim();
	if (!trimmed) return [];
	const keywords = extractKeywords(trimmed);
	const keywordItems =
		keywords.length === 0
			? store.searchItems(trimmed)
			: mergeLibraryItems(
					store.searchItemsByKeywords(keywords),
					searchExtractedText(keywords),
				);
	const semanticScores = await semanticLibraryHits({ query: trimmed });
	if (semanticScores.size === 0) {
		return rankLibraryItems(keywordItems, trimmed, keywords);
	}
	const byId = new Map(keywordItems.map((item) => [item.id, item]));
	for (const id of semanticScores.keys()) {
		if (byId.has(id)) continue;
		const item = store.getItem(id);
		if (item) byId.set(id, item);
	}
	return rankLibraryItems(
		[...byId.values()],
		trimmed,
		keywords,
		semanticScores,
	);
}

function mergeLibraryItems(...lists: readonly LibraryItem[][]): LibraryItem[] {
	const byId = new Map<string, LibraryItem>();
	for (const list of lists) {
		for (const item of list) {
			byId.set(item.id, item);
		}
	}
	return [...byId.values()];
}

function searchExtractedText(keywords: readonly string[]): LibraryItem[] {
	if (keywords.length === 0) return [];
	return store.listItems({ limit: 500 }).filter((item) => {
		const text = readExtractedText(item.id)?.toLowerCase() ?? "";
		if (!text) return false;
		return keywords.some((keyword) => text.includes(keyword));
	});
}

function haystack(item: LibraryItem): string {
	const extracted = readExtractedText(item.id) ?? "";
	return `${item.title} ${item.description} ${item.originalFilename} ${extracted}`.toLowerCase();
}

function scoreLibraryMatch(
	item: LibraryItem,
	query: string,
	keywords: readonly string[],
): number {
	const hay = haystack(item);
	const q = query.trim().toLowerCase();
	let score = item.status === "ready" ? 1 : 0;
	if (q.length > 0 && hay.includes(q)) {
		score += 10;
	}
	for (const kw of keywords) {
		if (hay.includes(kw)) score += 2;
	}
	return score;
}

function rankLibraryItems(
	items: readonly LibraryItem[],
	query: string,
	keywords: readonly string[],
	semanticScores?: ReadonlyMap<string, number>,
): LibraryItem[] {
	return [...items].sort((a, b) => {
		const semA = semanticScores?.get(a.id) ?? 0;
		const semB = semanticScores?.get(b.id) ?? 0;
		if (semA !== semB) return semB - semA;
		const kw =
			scoreLibraryMatch(b, query, keywords) -
			scoreLibraryMatch(a, query, keywords);
		if (kw !== 0) return kw;
		return b.updatedAt.localeCompare(a.updatedAt);
	});
}

export interface AddLibraryBytesInput {
	readonly filename: string;
	readonly bytes: Uint8Array;
	readonly mediaType?: string;
	readonly source: LibraryItemSource;
	/** Wait for summarize+embed (chat tools). UI callers leave this false. */
	readonly waitForIndex?: boolean;
}

export interface AddLibraryResult {
	readonly item: LibraryItem;
	readonly duplicate: boolean;
}

export async function addLibraryBytes(
	input: AddLibraryBytesInput,
): Promise<AddLibraryResult> {
	const filename = input.filename.trim();
	if (!filename) {
		throw new LibraryError("Filename is required.");
	}
	const mimeType = detectLibraryMediaType(filename, input.mediaType);
	if (!mimeType || !isAcceptedLibraryMediaType(mimeType)) {
		throw new LibraryError(
			"Library accepts text, Markdown, PDF, and images (PNG, JPEG, WebP, GIF).",
		);
	}
	if (input.bytes.byteLength === 0) {
		throw new LibraryError("File is empty.");
	}
	if (input.bytes.byteLength > LIBRARY_MAX_BYTES) {
		throw new LibraryError(
			`File is too large (${Math.round(input.bytes.byteLength / 1024)}KB). Maximum is ${Math.round(LIBRARY_MAX_BYTES / 1024)}KB.`,
		);
	}

	const hash = contentHash(input.bytes);
	const existing = store.findItemByContentHash(hash);
	if (existing) {
		return { item: existing, duplicate: true };
	}

	const itemId = crypto.randomUUID();
	const safeName = sanitizeLibraryFilename(filename);
	const relativePath = `${itemId}/${safeName}`;
	assertSafeRelativePath(relativePath);
	const dir = libraryItemDir(itemId);
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	fs.writeFileSync(path.join(dir, safeName), input.bytes, { mode: 0o600 });

	let item = store.insertItem({
		id: itemId,
		title: titleFromFilename(filename),
		originalFilename: filename,
		relativePath,
		mimeType,
		byteSize: input.bytes.byteLength,
		contentHash: hash,
		source: input.source,
	});

	if (input.waitForIndex) {
		item = await indexLibraryItem(item.id);
	} else {
		void indexLibraryItem(item.id).catch((error) => {
			log("warn", "general", "library_index_failed", {
				id: item.id,
				reason: error instanceof Error ? error.message : String(error),
			});
		});
	}
	return { item, duplicate: false };
}

export async function addLibraryText(input: {
	readonly filename: string;
	readonly content: string;
	readonly source: LibraryItemSource;
	readonly waitForIndex?: boolean;
}): Promise<AddLibraryResult> {
	const filename = input.filename.trim() || "note.md";
	const withExt = path.extname(filename) ? filename : `${filename}.md`;
	return addLibraryBytes({
		filename: withExt,
		bytes: Buffer.from(input.content, "utf8"),
		mediaType: withExt.toLowerCase().endsWith(".md")
			? "text/markdown"
			: "text/plain",
		source: input.source,
		waitForIndex: input.waitForIndex,
	});
}

export async function indexLibraryItem(id: string): Promise<LibraryItem> {
	const item = store.getItem(id);
	if (!item) {
		throw new LibraryError("Library item not found.", 404);
	}
	try {
		const abs = libraryItemAbsolutePath(item);
		const bytes = fs.readFileSync(abs);
		const extracted = await extractLibraryText({
			bytes,
			mimeType: item.mimeType,
		});
		if (extracted.error && extracted.text == null) {
			const failed = store.updateItem(id, {
				status: "failed",
				error: extracted.error,
			});
			return failed ?? item;
		}
		if (extracted.text) {
			writeExtractedText(id, extracted.text);
		}
		const description = await summarizeLibraryItem({
			filename: item.originalFilename,
			mimeType: item.mimeType,
			extractedText: extracted.text,
			bytes,
		});
		const ready = store.updateItem(id, {
			description,
			status: "ready",
			error: null,
		});
		const next = ready ?? { ...item, description, status: "ready" as const };
		const embedder = resolveLibraryEmbedder();
		if (embedder) {
			await storeLibraryEmbedding(next, embedder);
		}
		return store.getItem(id) ?? next;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		log("warn", "general", "library_index_failed", { id, reason: message });
		const failed = store.updateItem(id, { status: "failed", error: message });
		if (error instanceof GatewayFundsError) throw error;
		return failed ?? item;
	}
}

export async function updateLibraryItem(
	id: string,
	patch: {
		readonly title?: string;
		readonly description?: string;
		readonly filename?: string;
		readonly bytes?: Uint8Array;
		readonly mediaType?: string;
		readonly waitForIndex?: boolean;
	},
): Promise<LibraryItem> {
	const existing = store.getItem(id);
	if (!existing) {
		throw new LibraryError("Library item not found.", 404);
	}

	if (patch.bytes) {
		const filename = (patch.filename ?? existing.originalFilename).trim();
		const mimeType = detectLibraryMediaType(filename, patch.mediaType);
		if (!mimeType || !isAcceptedLibraryMediaType(mimeType)) {
			throw new LibraryError(
				"Library accepts text, Markdown, PDF, and images (PNG, JPEG, WebP, GIF).",
			);
		}
		if (patch.bytes.byteLength === 0) {
			throw new LibraryError("File is empty.");
		}
		if (patch.bytes.byteLength > LIBRARY_MAX_BYTES) {
			throw new LibraryError(
				`File is too large (${Math.round(patch.bytes.byteLength / 1024)}KB). Maximum is ${Math.round(LIBRARY_MAX_BYTES / 1024)}KB.`,
			);
		}
		const hash = contentHash(patch.bytes);
		const dup = store.findItemByContentHash(hash);
		if (dup && dup.id !== id) {
			throw new LibraryError(
				`That file is already in the library as "${dup.title}".`,
			);
		}
		const safeName = sanitizeLibraryFilename(filename);
		const dir = libraryItemDir(id);
		fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
		const previousAbs = libraryItemAbsolutePath(existing);
		const nextAbs = path.join(dir, safeName);
		if (previousAbs !== nextAbs && fs.existsSync(previousAbs)) {
			fs.rmSync(previousAbs, { force: true });
		}
		fs.writeFileSync(nextAbs, patch.bytes, { mode: 0o600 });
		store.updateItem(id, {
			title: patch.title?.trim() || titleFromFilename(filename),
			originalFilename: filename,
			relativePath: `${id}/${safeName}`,
			mimeType,
			byteSize: patch.bytes.byteLength,
			contentHash: hash,
			status: "pending",
			error: null,
			...(patch.description !== undefined
				? { description: patch.description }
				: {}),
		});
		if (patch.waitForIndex !== false) {
			return indexLibraryItem(id);
		}
		void indexLibraryItem(id).catch((error) => {
			log("warn", "general", "library_index_failed", {
				id,
				reason: error instanceof Error ? error.message : String(error),
			});
		});
		return store.getItem(id) ?? existing;
	}

	const nextTitle = patch.title?.trim();
	const nextDescription = patch.description;
	const updated = store.updateItem(id, {
		...(nextTitle ? { title: nextTitle } : {}),
		...(nextDescription !== undefined ? { description: nextDescription } : {}),
	});
	const item = updated ?? existing;
	if (nextTitle || nextDescription !== undefined) {
		const embedder = resolveLibraryEmbedder();
		if (embedder && item.status === "ready") {
			await storeLibraryEmbedding(item, embedder);
		}
	}
	return store.getItem(id) ?? item;
}

export function removeLibraryItem(id: string): boolean {
	const existing = store.getItem(id);
	if (!existing) return false;
	const dir = libraryItemDir(id);
	fs.rmSync(dir, { recursive: true, force: true });
	return store.deleteItem(id);
}

export function openLibraryItem(id: string): LibraryOpenResult {
	const item = store.getItem(id);
	if (!item) {
		throw new LibraryError("Library item not found.", 404);
	}
	const abs = libraryItemAbsolutePath(item);
	if (!fs.existsSync(abs)) {
		throw new LibraryError("Library file is missing from disk.", 404);
	}
	const extractedText = readExtractedText(id) ?? undefined;
	const bytes = fs.readFileSync(abs);
	return { item, extractedText, bytes };
}
