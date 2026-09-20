import path from "node:path";
import { CHAT_ATTACHMENT_MAX_BYTES_PER_FILE } from "../ai/model-capabilities";

export const LIBRARY_MAX_BYTES = CHAT_ATTACHMENT_MAX_BYTES_PER_FILE;
export const LIBRARY_EXTRACTED_SIDECAR = "extracted.txt";
export const LIBRARY_EMBED_EXCERPT_CHARS = 8_000;

export const LIBRARY_TEXT_MEDIA_TYPES = [
	"text/plain",
	"text/markdown",
] as const;

export const LIBRARY_IMAGE_MEDIA_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
] as const;

export const LIBRARY_PDF_MEDIA_TYPE = "application/pdf";

export const LIBRARY_ACCEPTED_MEDIA_TYPES = [
	...LIBRARY_TEXT_MEDIA_TYPES,
	LIBRARY_PDF_MEDIA_TYPE,
	...LIBRARY_IMAGE_MEDIA_TYPES,
] as const;

const ACCEPTED_SET = new Set<string>(LIBRARY_ACCEPTED_MEDIA_TYPES);

const EXTENSION_MEDIA_TYPES: Record<string, string> = {
	".txt": "text/plain",
	".text": "text/plain",
	".md": "text/markdown",
	".markdown": "text/markdown",
	".pdf": "application/pdf",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
};

export function detectLibraryMediaType(
	filename: string,
	mediaType?: string,
): string | null {
	const explicit = mediaType?.trim().toLowerCase();
	if (explicit) {
		if (explicit === "text/x-markdown") return "text/markdown";
		if (explicit === "image/jpg") return "image/jpeg";
		if (ACCEPTED_SET.has(explicit)) return explicit;
		if (explicit.startsWith("text/")) return "text/plain";
	}
	const ext = path.extname(filename).toLowerCase();
	return EXTENSION_MEDIA_TYPES[ext] ?? null;
}

export function isAcceptedLibraryMediaType(mediaType: string): boolean {
	return ACCEPTED_SET.has(mediaType.trim().toLowerCase());
}

export function isLibraryImageMediaType(mediaType: string): boolean {
	return (LIBRARY_IMAGE_MEDIA_TYPES as readonly string[]).includes(
		mediaType.trim().toLowerCase(),
	);
}

export function isLibraryTextMediaType(mediaType: string): boolean {
	const normalized = mediaType.trim().toLowerCase();
	return (LIBRARY_TEXT_MEDIA_TYPES as readonly string[]).includes(normalized);
}

export function isLibraryPdfMediaType(mediaType: string): boolean {
	return mediaType.trim().toLowerCase() === LIBRARY_PDF_MEDIA_TYPE;
}

export function titleFromFilename(filename: string): string {
	const base = path.basename(filename, path.extname(filename)).trim();
	const cleaned = base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
	return cleaned.length > 0 ? cleaned : filename;
}

/** Keep a single path segment; drop traversal and reserved sidecar names. */
export function sanitizeLibraryFilename(filename: string): string {
	const base = path.basename(filename).replace(/[\0]/g, "");
	const trimmed = base.replace(/[<>:"/\\|?*]/g, "_").trim();
	if (!trimmed || trimmed === "." || trimmed === "..") {
		return "file";
	}
	if (trimmed.toLowerCase() === LIBRARY_EXTRACTED_SIDECAR) {
		return `file-${trimmed}`;
	}
	return trimmed.slice(0, 180);
}
