import { Readability } from "@mozilla/readability";
import { type Tool, tool } from "ai";
import { parseHTML } from "linkedom";
import { z } from "zod";
import {
	PDF_MAX_URL_BYTES,
	extractPdfText,
	isPdfContentType,
	isPdfMagic,
	urlLooksLikePdf,
} from "./pdf-read-tool";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_CONTENT_LENGTH = 2 * 1024 * 1024;

const BROWSER_USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

export interface WebFetchResult {
	readonly ok: boolean;
	readonly url: string;
	readonly title?: string;
	readonly textContent?: string;
	readonly excerpt?: string;
	readonly siteName?: string;
	readonly byline?: string;
	readonly error?: string;
}

async function fetchAndExtract(url: string): Promise<WebFetchResult> {
	try {
		const response = await fetch(url, {
			headers: {
				"User-Agent": BROWSER_USER_AGENT,
				Accept:
					"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				"Accept-Language": "en-US,en;q=0.5",
			},
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			redirect: "follow",
		});

		if (!response.ok) {
			return {
				ok: false,
				url,
				error: `HTTP ${response.status} ${response.statusText}`,
			};
		}

		const contentType = response.headers.get("content-type") ?? "";
		const treatAsPdf = isPdfContentType(contentType) || urlLooksLikePdf(url);
		if (treatAsPdf) {
			const buffer = await response.arrayBuffer();
			if (buffer.byteLength > PDF_MAX_URL_BYTES) {
				return {
					ok: false,
					url,
					error: `PDF too large (${Math.round(buffer.byteLength / 1024)}KB)`,
				};
			}
			const bytes = new Uint8Array(buffer);
			if (!isPdfMagic(bytes) && !isPdfContentType(contentType)) {
				return {
					ok: false,
					url,
					error: `Unsupported content type: ${contentType || "(missing)"}`,
				};
			}
			const extracted = await extractPdfText({
				bytes,
				maxBytes: PDF_MAX_URL_BYTES,
			});
			if (!extracted.ok) {
				return { ok: false, url, error: extracted.error };
			}
			return {
				ok: true,
				url,
				title: extracted.title,
				textContent: extracted.text,
			};
		}

		if (!contentType.includes("html") && !contentType.includes("xml")) {
			return {
				ok: false,
				url,
				error: `Unsupported content type: ${contentType}`,
			};
		}

		const buffer = await response.arrayBuffer();
		if (buffer.byteLength > MAX_CONTENT_LENGTH) {
			return {
				ok: false,
				url,
				error: `Page too large (${Math.round(buffer.byteLength / 1024)}KB)`,
			};
		}

		const html = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
		const { document } = parseHTML(html);

		const reader = new Readability(document as unknown as Document);
		const article = reader.parse();

		if (!article || !article.textContent?.trim()) {
			return {
				ok: false,
				url,
				error:
					"Could not extract readable content. The page may be primarily non-text (e.g. a video or interactive app). For PDFs, use readPdf.",
			};
		}

		return {
			ok: true,
			url,
			title: article.title || undefined,
			textContent: article.textContent.trim(),
			excerpt: article.excerpt || undefined,
			siteName: article.siteName || undefined,
			byline: article.byline || undefined,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { ok: false, url, error: message };
	}
}

export function createWebFetchTools(): Record<string, Tool> {
	const fetchWebContent = tool({
		description:
			"Fetch a web page and extract its main readable content, stripping ads, navigation, footers, and other boilerplate. Returns the article title, clean text content, excerpt, and metadata. Use this to read blog posts, articles, documentation, or any web page with substantive text content.",
		inputSchema: z.object({
			url: z.string().describe("The URL to fetch and extract content from"),
		}),
		execute: async ({ url }) => {
			const result = await fetchAndExtract(url);
			if (!result.ok) {
				return { ok: false, url: result.url, error: result.error };
			}
			return {
				ok: true,
				url: result.url,
				title: result.title,
				textContent: result.textContent,
				excerpt: result.excerpt,
				siteName: result.siteName,
				byline: result.byline,
			};
		},
	});

	return { fetchWebContent };
}
