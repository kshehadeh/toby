import fs from "node:fs";
import path from "node:path";
import { type Tool, tool } from "ai";
import { extractText, getDocumentProxy, getMeta } from "unpdf";
import { z } from "zod";
import type { ValidatedChatAttachment } from "../chat-pipeline/attachments";
import type { Project } from "../projects/index";
import { CHAT_ATTACHMENT_MAX_BYTES_PER_FILE } from "./model-capabilities";

export const PDF_MAX_FILE_BYTES = CHAT_ATTACHMENT_MAX_BYTES_PER_FILE;
export const PDF_MAX_URL_BYTES = 10 * 1024 * 1024;
export const PDF_MAX_TEXT_CHARS = 80_000;
export const PDF_FETCH_TIMEOUT_MS = 15_000;

const PDF_USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

export type PdfSourceKind = "attachment" | "project" | "url";

export type ExtractPdfSuccess = {
	readonly ok: true;
	readonly title?: string;
	readonly pageCount: number;
	readonly pagesRead: { readonly start: number; readonly end: number };
	readonly text: string;
	readonly truncated?: boolean;
};

export type ExtractPdfFailure = {
	readonly ok: false;
	readonly error: string;
};

export type ExtractPdfResult = ExtractPdfSuccess | ExtractPdfFailure;

export type ReadPdfSuccess = ExtractPdfSuccess & {
	readonly source: { readonly kind: PdfSourceKind; readonly value: string };
};

export type ReadPdfResult =
	| ReadPdfSuccess
	| {
			readonly ok: false;
			readonly error: string;
	  };

interface PdfReadToolsContext {
	readonly attachments?: readonly ValidatedChatAttachment[];
	readonly project?: Project | null;
	readonly fetchImpl?: typeof fetch;
}

const readPdfInputSchema = z.object({
	filename: z
		.string()
		.min(1)
		.optional()
		.describe(
			"Exact filename of a PDF attached to the current user message. Omit when exactly one PDF is attached — the tool reads that file automatically.",
		),
	path: z
		.string()
		.min(1)
		.optional()
		.describe(
			"Project-relative path to a PDF already in the active project (project chats only)",
		),
	url: z
		.string()
		.min(1)
		.optional()
		.describe("http(s) URL of a PDF to download and extract"),
	startPage: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("1-indexed first page to extract (inclusive)"),
	endPage: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("1-indexed last page to extract (inclusive)"),
});

export function isPdfContentType(contentType: string): boolean {
	return contentType.toLowerCase().includes("application/pdf");
}

export function urlLooksLikePdf(url: string): boolean {
	try {
		return new URL(url).pathname.toLowerCase().endsWith(".pdf");
	} catch {
		return /\.pdf(?:$|[?#])/i.test(url);
	}
}

export function isPdfMagic(bytes: Uint8Array): boolean {
	return (
		bytes.length >= 4 &&
		bytes[0] === 0x25 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x44 &&
		bytes[3] === 0x46
	);
}

function isEncryptedError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /password|encrypt/i.test(message);
}

function pageMarker(pageNumber: number, pageText: string): string {
	return `--- page ${pageNumber} ---\n${pageText}`;
}

export async function extractPdfText(params: {
	readonly bytes: Uint8Array;
	readonly startPage?: number;
	readonly endPage?: number;
	readonly maxBytes?: number;
	readonly maxTextChars?: number;
}): Promise<ExtractPdfResult> {
	const maxBytes = params.maxBytes ?? PDF_MAX_FILE_BYTES;
	const maxTextChars = params.maxTextChars ?? PDF_MAX_TEXT_CHARS;

	const bytes =
		params.bytes instanceof Uint8Array && !Buffer.isBuffer(params.bytes)
			? params.bytes
			: new Uint8Array(params.bytes);

	if (bytes.byteLength > maxBytes) {
		return {
			ok: false,
			error: `PDF is too large (${Math.round(bytes.byteLength / 1024)}KB). Maximum is ${Math.round(maxBytes / 1024)}KB.`,
		};
	}
	if (!isPdfMagic(bytes)) {
		return { ok: false, error: "File is not a PDF (missing %PDF header)." };
	}

	try {
		const pdf = await getDocumentProxy(bytes);
		const { totalPages, text: pages } = await extractText(pdf, {
			mergePages: false,
		});
		const pageCount = totalPages || pages.length;
		if (pageCount <= 0) {
			return { ok: false, error: "PDF has no pages." };
		}

		const startPage = params.startPage ?? 1;
		const requestedEnd = params.endPage ?? pageCount;
		if (startPage < 1) {
			return { ok: false, error: "startPage must be 1 or greater." };
		}
		if (requestedEnd < startPage) {
			return {
				ok: false,
				error: "endPage must be greater than or equal to startPage.",
			};
		}
		if (startPage > pageCount) {
			return {
				ok: false,
				error: `startPage ${startPage} is past the end of the document (${pageCount} pages).`,
			};
		}
		const endPage = Math.min(requestedEnd, pageCount);

		const parts: string[] = [];
		let used = 0;
		let lastIncluded = startPage - 1;
		let truncated = false;
		for (let pageNumber = startPage; pageNumber <= endPage; pageNumber++) {
			const pageText = (pages[pageNumber - 1] ?? "").trim();
			const chunk = pageMarker(pageNumber, pageText);
			const separator = parts.length > 0 ? "\n\n" : "";
			const addition = `${separator}${chunk}`;
			if (used + addition.length > maxTextChars) {
				if (parts.length === 0) {
					const room = Math.max(0, maxTextChars - separator.length);
					parts.push(chunk.slice(0, room));
					lastIncluded = pageNumber;
				}
				truncated = true;
				break;
			}
			parts.push(chunk);
			used += addition.length;
			lastIncluded = pageNumber;
		}

		if (lastIncluded < startPage) {
			return {
				ok: false,
				error: "Could not extract any text within the character budget.",
			};
		}

		const text = parts.join("\n\n").trim();
		if (!text.replace(/--- page \d+ ---/g, "").trim()) {
			return {
				ok: false,
				error:
					"No extractable text layer. This PDF may be scanned images; OCR is not supported.",
			};
		}

		let title: string | undefined;
		try {
			const meta = await getMeta(pdf);
			const rawTitle = meta.info?.Title;
			if (typeof rawTitle === "string" && rawTitle.trim()) {
				title = rawTitle.trim();
			}
		} catch {
			// Metadata is optional.
		}

		return {
			ok: true,
			...(title ? { title } : {}),
			pageCount,
			pagesRead: { start: startPage, end: lastIncluded },
			text,
			...(truncated || lastIncluded < endPage ? { truncated: true } : {}),
		};
	} catch (error) {
		if (isEncryptedError(error)) {
			return {
				ok: false,
				error: "PDF is password-protected or encrypted.",
			};
		}
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, error: `Failed to parse PDF: ${message}` };
	}
}

export async function fetchPdfBytes(
	url: string,
	fetchImpl: typeof fetch = fetch,
): Promise<
	| { readonly ok: true; readonly bytes: Uint8Array; readonly url: string }
	| { readonly ok: false; readonly error: string; readonly url: string }
> {
	let parsed: URL;
	try {
		parsed = new URL(url.trim());
	} catch {
		return { ok: false, url, error: "Invalid URL." };
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return {
			ok: false,
			url,
			error: "Only http and https URLs are allowed.",
		};
	}

	try {
		const response = await fetchImpl(parsed.toString(), {
			headers: {
				"User-Agent": PDF_USER_AGENT,
				Accept: "application/pdf,*/*;q=0.8",
			},
			signal: AbortSignal.timeout(PDF_FETCH_TIMEOUT_MS),
			redirect: "follow",
		});
		if (!response.ok) {
			return {
				ok: false,
				url: parsed.toString(),
				error: `HTTP ${response.status} ${response.statusText}`,
			};
		}
		const buffer = await response.arrayBuffer();
		if (buffer.byteLength > PDF_MAX_URL_BYTES) {
			return {
				ok: false,
				url: parsed.toString(),
				error: `PDF is too large (${Math.round(buffer.byteLength / 1024)}KB). Maximum is ${Math.round(PDF_MAX_URL_BYTES / 1024)}KB.`,
			};
		}
		return {
			ok: true,
			url: parsed.toString(),
			bytes: new Uint8Array(buffer),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, url: parsed.toString(), error: message };
	}
}

function resolveProjectPdfPath(
	project: Project,
	inputPath: string,
): { ok: true; absPath: string } | { ok: false; error: string } {
	const raw = inputPath.trim();
	if (!raw) {
		return { ok: false, error: "path must not be empty." };
	}
	if (path.isAbsolute(raw)) {
		return { ok: false, error: "path must be relative to the project folder." };
	}
	const normalized = path.normalize(raw);
	if (
		normalized === ".." ||
		normalized.startsWith(`..${path.sep}`) ||
		normalized.split(path.sep).includes("..")
	) {
		return {
			ok: false,
			error: "path must not traverse outside the project folder.",
		};
	}
	const absPath = path.resolve(project.folderPath, normalized);
	const relCheck = path.relative(project.folderPath, absPath);
	if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
		return { ok: false, error: "Resolved path escapes the project folder." };
	}
	return { ok: true, absPath };
}

function readProjectPdfFile(
	project: Project,
	inputPath: string,
): { ok: true; bytes: Uint8Array } | { ok: false; error: string } {
	const target = resolveProjectPdfPath(project, inputPath);
	if (!target.ok) return target;
	try {
		const stat = fs.lstatSync(target.absPath);
		if (!stat.isFile() || stat.isSymbolicLink()) {
			return {
				ok: false,
				error: "Path must be a regular file, not a folder or symbolic link.",
			};
		}
		if (stat.size > PDF_MAX_FILE_BYTES) {
			return {
				ok: false,
				error: `PDF is too large (${Math.round(stat.size / 1024)}KB). Maximum is ${Math.round(PDF_MAX_FILE_BYTES / 1024)}KB.`,
			};
		}
		return { ok: true, bytes: new Uint8Array(fs.readFileSync(target.absPath)) };
	} catch {
		return { ok: false, error: "File does not exist." };
	}
}

function attachmentBytes(attachment: ValidatedChatAttachment): Uint8Array {
	return new Uint8Array(Buffer.from(attachment.dataBase64, "base64"));
}

function nonempty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function currentTurnPdfAttachments(
	attachments: readonly ValidatedChatAttachment[] | undefined,
): readonly ValidatedChatAttachment[] {
	return (attachments ?? []).filter(
		(attachment) => attachment.mediaType === "application/pdf",
	);
}

type ResolvedPdfSource =
	| { readonly kind: "attachment"; readonly value: string }
	| { readonly kind: "project"; readonly value: string }
	| { readonly kind: "url"; readonly value: string }
	| { readonly error: string };

function resolveReadPdfSource(params: {
	readonly filename?: string;
	readonly path?: string;
	readonly url?: string;
	readonly attachments?: readonly ValidatedChatAttachment[];
}): ResolvedPdfSource {
	const filename = nonempty(params.filename);
	const filePath = nonempty(params.path);
	const url = nonempty(params.url);
	const provided = [
		filename ? "filename" : null,
		filePath ? "path" : null,
		url ? "url" : null,
	].filter(Boolean);
	if (provided.length > 1) {
		return {
			error: "Provide only one of filename, path, or url.",
		};
	}
	if (filename) return { kind: "attachment", value: filename };
	if (filePath) return { kind: "project", value: filePath };
	if (url) return { kind: "url", value: url };

	const pdfs = currentTurnPdfAttachments(params.attachments);
	if (pdfs.length === 1 && pdfs[0]) {
		return { kind: "attachment", value: pdfs[0].filename };
	}
	if (pdfs.length > 1) {
		const names = pdfs.map((pdf) => pdf.filename).join(", ");
		return {
			error: `Multiple PDFs are attached (${names}). Pass filename to choose one.`,
		};
	}
	return {
		error:
			"No PDF source. Attach a PDF, or pass filename, a project-relative path, or a url.",
	};
}

export function createPdfReadTools(
	ctx: PdfReadToolsContext = {},
): Record<string, Tool> {
	const fetchImpl = ctx.fetchImpl ?? fetch;
	const readPdf = tool({
		description:
			"Extract searchable text from a PDF and return it in the current context. Use when the user attaches a PDF, asks to read or summarize a PDF, points at a .pdf file in the active project, or shares a PDF URL. If exactly one PDF is attached to this turn, you may call this with no filename. Prefer this over fetchWebContent for PDFs. Native file attachments may still be present for multimodal models; still call this when you need the text layer. Does not OCR scanned image PDFs.",
		inputSchema: readPdfInputSchema,
		execute: async ({
			filename,
			path: inputPath,
			url,
			startPage,
			endPage,
		}): Promise<ReadPdfResult> => {
			const source = resolveReadPdfSource({
				filename,
				path: inputPath,
				url,
				attachments: ctx.attachments,
			});
			if ("error" in source) {
				return { ok: false, error: source.error };
			}

			const range = { startPage, endPage };
			if (source.kind === "attachment") {
				const attachment = ctx.attachments?.find(
					(candidate) => candidate.filename === source.value,
				);
				if (!attachment) {
					return {
						ok: false,
						error: `No current-turn attachment named "${source.value}".`,
					};
				}
				if (attachment.mediaType !== "application/pdf") {
					return {
						ok: false,
						error: `"${source.value}" is not a PDF (${attachment.mediaType}).`,
					};
				}
				const extracted = await extractPdfText({
					bytes: attachmentBytes(attachment),
					...range,
				});
				if (!extracted.ok) return extracted;
				return {
					...extracted,
					source,
				};
			}

			if (source.kind === "project") {
				if (!ctx.project) {
					return {
						ok: false,
						error: "path can only be used in a project chat.",
					};
				}
				const file = readProjectPdfFile(ctx.project, source.value);
				if (!file.ok) return file;
				const extracted = await extractPdfText({
					bytes: file.bytes,
					...range,
				});
				if (!extracted.ok) return extracted;
				return {
					...extracted,
					source,
				};
			}

			const downloaded = await fetchPdfBytes(source.value, fetchImpl);
			if (!downloaded.ok) {
				return { ok: false, error: downloaded.error };
			}
			const extracted = await extractPdfText({
				bytes: downloaded.bytes,
				maxBytes: PDF_MAX_URL_BYTES,
				...range,
			});
			if (!extracted.ok) return extracted;
			return {
				...extracted,
				source: { kind: "url", value: downloaded.url },
			};
		},
	});

	return { readPdf };
}
