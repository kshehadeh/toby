import { describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	createGlobalChatTools,
	globalChatToolsPromptSection,
} from "@toby/core/ai/global-chat-tools";
import {
	createPdfReadTools,
	extractPdfText,
	isPdfMagic,
} from "@toby/core/ai/pdf-read-tool";
import { createWebFetchTools } from "@toby/core/ai/web-fetch-tool";
import { ALWAYS_INCLUDED_TOOLS } from "@toby/core/chat-pipeline/run-turn";
import type { Persona } from "@toby/core/config/index";
import type { Project } from "@toby/core/projects/index";

const persona: Persona = {
	name: "Test",
	instructions: "",
	promptMode: "add",
	ai: { provider: "ollama", model: "llama3.2" },
};

function makeTextPdf(pages: readonly string[]): Uint8Array {
	const catalogNum = 1;
	const pagesNum = 2;
	const fontNum = 3;
	let next = 4;
	const pageNums: number[] = [];
	const contentNums: number[] = [];
	for (const _ of pages) {
		pageNums.push(next++);
		contentNums.push(next++);
	}

	const obj = (num: number, body: string) => `${num} 0 obj\n${body}\nendobj\n`;
	const escaped = (s: string) =>
		s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

	const bodies: string[] = [];
	bodies[catalogNum] = obj(
		catalogNum,
		`<< /Type /Catalog /Pages ${pagesNum} 0 R >>`,
	);
	bodies[pagesNum] = obj(
		pagesNum,
		`<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`,
	);
	bodies[fontNum] = obj(
		fontNum,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	);

	for (let i = 0; i < pages.length; i++) {
		const stream = `BT /F1 12 Tf 72 720 Td (${escaped(pages[i] ?? "")}) Tj ET`;
		bodies[contentNums[i] ?? 0] = obj(
			contentNums[i] ?? 0,
			`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		);
		bodies[pageNums[i] ?? 0] = obj(
			pageNums[i] ?? 0,
			`<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 612 792] /Contents ${contentNums[i]} 0 R /Resources << /Font << /F1 ${fontNum} 0 R >> >> >>`,
		);
	}

	let out = "%PDF-1.1\n";
	const xref: number[] = [0];
	for (let i = 1; i < bodies.length; i++) {
		const body = bodies[i];
		if (!body) continue;
		xref[i] = Buffer.byteLength(out, "latin1");
		out += body;
	}
	const startxref = Buffer.byteLength(out, "latin1");
	const size = bodies.length;
	let xrefTable = `xref\n0 ${size}\n`;
	xrefTable += "0000000000 65535 f \n";
	for (let i = 1; i < size; i++) {
		xrefTable += `${String(xref[i]).padStart(10, "0")} 00000 n \n`;
	}
	out += xrefTable;
	out += `trailer\n<< /Size ${size} /Root ${catalogNum} 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
	return new Uint8Array(Buffer.from(out, "latin1"));
}

function toAttachment(filename: string, bytes: Uint8Array) {
	const dataBase64 = Buffer.from(bytes).toString("base64");
	return {
		filename,
		mediaType: "application/pdf" as const,
		dataBase64,
		byteSize: bytes.byteLength,
	};
}

type ReadPdfExecute = (input: {
	filename?: string;
	path?: string;
	url?: string;
	startPage?: number;
	endPage?: number;
}) => Promise<{
	ok: boolean;
	text?: string;
	error?: string;
	truncated?: boolean;
	pageCount?: number;
	pagesRead?: { start: number; end: number };
	source?: { kind: string; value: string };
}>;

describe("extractPdfText", () => {
	it("extracts text with page markers", async () => {
		const bytes = makeTextPdf(["Hello Toby", "Page two"]);
		expect(isPdfMagic(bytes)).toBe(true);
		const result = await extractPdfText({ bytes });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.pageCount).toBe(2);
		expect(result.pagesRead).toEqual({ start: 1, end: 2 });
		expect(result.text).toContain("Hello Toby");
		expect(result.text).toContain("Page two");
		expect(result.text).toContain("--- page 1 ---");
		expect(result.text).toContain("--- page 2 ---");
		expect(result.truncated).toBeUndefined();
	});

	it("honors a page range", async () => {
		const bytes = makeTextPdf(["One", "Two", "Three"]);
		const result = await extractPdfText({
			bytes,
			startPage: 2,
			endPage: 2,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.pagesRead).toEqual({ start: 2, end: 2 });
		expect(result.text).toContain("Two");
		expect(result.text).not.toContain("One");
		expect(result.text).not.toContain("Three");
	});

	it("sets truncated when over the character budget", async () => {
		const bytes = makeTextPdf(["AAAAAAAAAA", "BBBBBBBBBB"]);
		const result = await extractPdfText({ bytes, maxTextChars: 40 });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.truncated).toBe(true);
		expect(result.pagesRead.end).toBe(1);
		expect(result.text).toContain("AAAAAAAAAA");
		expect(result.text).not.toContain("BBBBBBBBBB");
	});

	it("rejects missing PDF magic", async () => {
		const result = await extractPdfText({
			bytes: new Uint8Array(Buffer.from("not a pdf")),
		});
		expect(result).toMatchObject({
			ok: false,
			error: expect.stringContaining("%PDF"),
		});
	});

	it("rejects oversized buffers", async () => {
		const bytes = makeTextPdf(["Hello Toby"]);
		const result = await extractPdfText({ bytes, maxBytes: 10 });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain("too large");
	});

	it("rejects an empty text layer", async () => {
		const bytes = makeTextPdf(["   "]);
		const result = await extractPdfText({ bytes });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain("No extractable text layer");
	});
});

describe("createPdfReadTools", () => {
	it("reads a current-turn PDF attachment by filename", async () => {
		const bytes = makeTextPdf(["Hello Toby"]);
		const tools = createPdfReadTools({
			attachments: [toAttachment("brief.pdf", bytes)],
		});
		const execute = tools.readPdf?.execute as ReadPdfExecute | undefined;
		const result = await execute?.({ filename: "brief.pdf" });
		expect(result?.ok).toBe(true);
		expect(result?.source).toEqual({ kind: "attachment", value: "brief.pdf" });
		expect(result?.text).toContain("Hello Toby");
	});

	it("reads a project-relative PDF and rejects traversal", async () => {
		const folderPath = fs.mkdtempSync(path.join(os.tmpdir(), "toby-pdf-"));
		const project = {
			id: "project-1",
			name: "Test Project",
			folderPath,
		} as Project;
		const bytes = makeTextPdf(["Project PDF"]);
		fs.mkdirSync(path.join(folderPath, "attachments"));
		fs.writeFileSync(path.join(folderPath, "attachments", "brief.pdf"), bytes);
		const tools = createPdfReadTools({ project });
		const execute = tools.readPdf?.execute as ReadPdfExecute | undefined;
		try {
			const result = await execute?.({ path: "attachments/brief.pdf" });
			expect(result?.ok).toBe(true);
			expect(result?.source).toEqual({
				kind: "project",
				value: "attachments/brief.pdf",
			});
			expect(result?.text).toContain("Project PDF");

			const escaped = await execute?.({ path: "../outside.pdf" });
			expect(escaped?.ok).toBe(false);
			const absolute = await execute?.({ path: "/tmp/outside.pdf" });
			expect(absolute?.ok).toBe(false);
		} finally {
			fs.rmSync(folderPath, { recursive: true, force: true });
		}
	});

	it("fetches a PDF URL", async () => {
		const bytes = makeTextPdf(["From the web"]);
		const fetchImpl = mock(async () => {
			return new Response(bytes, {
				status: 200,
				headers: { "content-type": "application/pdf" },
			});
		}) as unknown as typeof fetch;
		const tools = createPdfReadTools({ fetchImpl });
		const execute = tools.readPdf?.execute as ReadPdfExecute | undefined;
		const result = await execute?.({ url: "https://example.com/doc.pdf" });
		expect(result?.ok).toBe(true);
		expect(result?.source?.kind).toBe("url");
		expect(result?.text).toContain("From the web");
	});

	it("reads the sole current-turn PDF when no source is given", async () => {
		const bytes = makeTextPdf(["Hello Toby"]);
		const tools = createPdfReadTools({
			attachments: [toAttachment("brief.pdf", bytes)],
		});
		const execute = tools.readPdf?.execute as ReadPdfExecute | undefined;
		const result = await execute?.({});
		expect(result?.ok).toBe(true);
		expect(result?.source).toEqual({ kind: "attachment", value: "brief.pdf" });
		expect(result?.text).toContain("Hello Toby");
	});

	it("rejects missing or mixed sources", async () => {
		const tools = createPdfReadTools();
		const execute = tools.readPdf?.execute as ReadPdfExecute | undefined;
		expect((await execute?.({}))?.ok).toBe(false);
		expect((await execute?.({}))?.error).toContain("No PDF source");
		expect(
			(await execute?.({ filename: "a.pdf", url: "https://example.com/a.pdf" }))
				?.ok,
		).toBe(false);
	});

	it("asks for a filename when multiple PDFs are attached", async () => {
		const tools = createPdfReadTools({
			attachments: [
				toAttachment("a.pdf", makeTextPdf(["A"])),
				toAttachment("b.pdf", makeTextPdf(["B"])),
			],
		});
		const execute = tools.readPdf?.execute as ReadPdfExecute | undefined;
		const result = await execute?.({});
		expect(result?.ok).toBe(false);
		expect(result?.error).toContain("Multiple PDFs");
		expect(result?.error).toContain("a.pdf");
	});

	it("is registered on global chat tools and always included", () => {
		const tools = createGlobalChatTools({
			dryRun: false,
			persona,
			appliedActions: [],
		});
		expect(tools.readPdf).toBeDefined();
		expect(ALWAYS_INCLUDED_TOOLS.has("readPdf")).toBe(true);
		expect(globalChatToolsPromptSection(null, persona)).toContain(
			"**readPdf**",
		);
	});
});

describe("fetchWebContent PDF", () => {
	it("extracts PDF responses instead of rejecting them", async () => {
		const bytes = makeTextPdf(["From fetch"]);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(async () => {
			return new Response(bytes, {
				status: 200,
				headers: { "content-type": "application/pdf" },
			});
		}) as typeof fetch;
		try {
			const execute = createWebFetchTools().fetchWebContent?.execute as
				| ((input: { url: string }) => Promise<{
						ok: boolean;
						textContent?: string;
						error?: string;
				  }>)
				| undefined;
			const result = await execute?.({ url: "https://example.com/doc.pdf" });
			expect(result?.ok).toBe(true);
			expect(result?.textContent).toContain("From fetch");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
