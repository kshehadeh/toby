import fs from "node:fs";
import path from "node:path";
import { extractPdfText } from "../ai/pdf-read-tool";
import { getLibraryDir } from "../config/index";
import {
	LIBRARY_EMBED_EXCERPT_CHARS,
	LIBRARY_EXTRACTED_SIDECAR,
	isLibraryImageMediaType,
	isLibraryPdfMediaType,
	isLibraryTextMediaType,
} from "./media";
import type { LibraryItem } from "./types";

export function libraryItemDir(itemId: string): string {
	return path.join(getLibraryDir(), itemId);
}

export function libraryItemAbsolutePath(item: LibraryItem): string {
	return path.join(getLibraryDir(), item.relativePath);
}

export function librarySidecarPath(itemId: string): string {
	return path.join(libraryItemDir(itemId), LIBRARY_EXTRACTED_SIDECAR);
}

export function readExtractedText(itemId: string): string | null {
	const sidecar = librarySidecarPath(itemId);
	try {
		if (!fs.existsSync(sidecar)) return null;
		return fs.readFileSync(sidecar, "utf8");
	} catch {
		return null;
	}
}

export function writeExtractedText(itemId: string, text: string): void {
	const sidecar = librarySidecarPath(itemId);
	fs.writeFileSync(sidecar, text, { encoding: "utf8", mode: 0o600 });
}

export function formatLibraryEmbedText(item: {
	readonly title: string;
	readonly description: string;
	readonly originalFilename?: string;
	readonly extractedText?: string | null;
}): string {
	const parts = [item.title.trim()];
	if (item.originalFilename?.trim()) {
		parts.push(item.originalFilename.trim());
	}
	if (item.description.trim()) {
		parts.push(item.description.trim());
	}
	const excerpt = item.extractedText
		?.trim()
		.slice(0, LIBRARY_EMBED_EXCERPT_CHARS);
	if (excerpt) {
		parts.push(excerpt);
	}
	return parts.filter(Boolean).join("\n");
}

export async function extractLibraryText(params: {
	readonly bytes: Uint8Array;
	readonly mimeType: string;
}): Promise<{ readonly text: string | null; readonly error?: string }> {
	if (isLibraryImageMediaType(params.mimeType)) {
		return { text: null };
	}
	if (isLibraryPdfMediaType(params.mimeType)) {
		const result = await extractPdfText({ bytes: params.bytes });
		if (!result.ok) {
			return { text: null, error: result.error };
		}
		return { text: result.text };
	}
	if (isLibraryTextMediaType(params.mimeType)) {
		const text = Buffer.from(params.bytes).toString("utf8");
		if (text.includes("\u0000")) {
			return { text: null, error: "File is not valid UTF-8 text." };
		}
		return { text };
	}
	return {
		text: null,
		error: `Unsupported library media type: ${params.mimeType}`,
	};
}

function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
	if (bytes.byteLength < 24) return null;
	const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	for (let i = 0; i < pngMagic.length; i++) {
		if (bytes[i] !== pngMagic[i]) return null;
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

export function describeImageFallback(params: {
	readonly filename: string;
	readonly mimeType: string;
	readonly bytes: Uint8Array;
}): string {
	const size = pngSize(params.bytes);
	const dims = size ? ` ${size.width}×${size.height}` : "";
	return `Image file ${params.filename} (${params.mimeType}${dims}).`;
}
