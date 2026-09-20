import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runWithLibraryEmbedTestHooks } from "@toby/core/library/embeddings";
import { formatLibraryEmbedText } from "@toby/core/library/extract";
import {
	addLibraryBytes,
	addLibraryText,
	getLibraryItem,
	listLibraryItems,
	openLibraryItem,
	removeLibraryItem,
	searchLibrary,
	updateLibraryItem,
} from "@toby/core/library/library-service";
import { closeLibraryDbForTests } from "@toby/core/library/library-store";
import { runWithLibrarySummarizeTestHooks } from "@toby/core/library/summarize";
import { closeChatDb } from "@toby/core/session-store";
import {
	embedVectorByText,
	stubEmbedTexts,
} from "./helpers/setup-memory-embed-mocks";

const isBun =
	typeof (globalThis as unknown as { Bun?: unknown }).Bun !== "undefined";

const TMP_DIR = path.join(os.tmpdir(), `toby-library-test-${randomUUID()}`);

function withLibraryHooks<T>(fn: () => T): T {
	embedVectorByText.clear();
	return runWithLibrarySummarizeTestHooks(
		{
			summarize: async (params) => `Summary of ${params.filename}`,
		},
		() =>
			runWithLibraryEmbedTestHooks(
				{
					resolveEmbedder: () => ({
						model: {} as never,
						modelId: "test-embed-model",
					}),
					embedTexts: stubEmbedTexts,
				},
				fn,
			),
	);
}

beforeEach(() => {
	fs.mkdirSync(TMP_DIR, { recursive: true });
	process.env.TOBY_DIR = TMP_DIR;
});

afterEach(() => {
	closeLibraryDbForTests();
	closeChatDb();
	try {
		fs.rmSync(TMP_DIR, { recursive: true, force: true });
	} catch {
		// ignore
	}
	Reflect.deleteProperty(process.env, "TOBY_DIR");
});

describe.skipIf(!isBun)("library", () => {
	it("copies a text file, indexes it, and stores a description", async () => {
		await withLibraryHooks(async () => {
			const result = await addLibraryText({
				filename: "quarterly-plan.md",
				content: "# Plan\nShip the library feature this week.",
				source: "ui",
				waitForIndex: true,
			});
			expect(result.duplicate).toBe(false);
			expect(result.item.title).toBe("quarterly plan");
			expect(result.item.status).toBe("ready");
			expect(result.item.description).toBe("Summary of quarterly-plan.md");
			expect(result.item.mimeType).toBe("text/markdown");
			const abs = path.join(TMP_DIR, "library", result.item.relativePath);
			expect(fs.existsSync(abs)).toBe(true);
			expect(fs.readFileSync(abs, "utf8")).toContain("Ship the library");
			const sidecar = path.join(
				TMP_DIR,
				"library",
				result.item.id,
				"extracted.txt",
			);
			expect(fs.readFileSync(sidecar, "utf8")).toContain("Ship the library");
		});
	});

	it("returns the existing item when the same bytes are added twice", async () => {
		await withLibraryHooks(async () => {
			const first = await addLibraryText({
				filename: "note.txt",
				content: "same bytes",
				source: "ui",
				waitForIndex: true,
			});
			const second = await addLibraryText({
				filename: "note-copy.txt",
				content: "same bytes",
				source: "tool",
				waitForIndex: true,
			});
			expect(second.duplicate).toBe(true);
			expect(second.item.id).toBe(first.item.id);
			expect(listLibraryItems()).toHaveLength(1);
		});
	});

	it("rejects unsupported file types", async () => {
		await withLibraryHooks(async () => {
			await expect(
				addLibraryBytes({
					filename: "archive.zip",
					bytes: Buffer.from("PK"),
					source: "ui",
				}),
			).rejects.toThrow(/text, Markdown, PDF, and images/);
		});
	});

	it("finds an item by keyword and by meaning", async () => {
		await withLibraryHooks(async () => {
			const content = "Lease for the Baltimore apartment.";
			const expectedEmbed = formatLibraryEmbedText({
				title: "home",
				description: "Summary of home.md",
				originalFilename: "home.md",
				extractedText: content,
			});
			embedVectorByText.set(expectedEmbed, [1, 0, 0]);
			embedVectorByText.set("where is the lease", [0.99, 0.1, 0]);

			const added = await addLibraryText({
				filename: "home.md",
				content,
				source: "ui",
				waitForIndex: true,
			});
			const keywordHits = await searchLibrary("Baltimore");
			expect(keywordHits.map((item) => item.id)).toContain(added.item.id);

			const semanticHits = await searchLibrary("where is the lease");
			expect(semanticHits[0]?.id).toBe(added.item.id);
		});
	});

	it("opens extracted text and removes the folder on delete", async () => {
		await withLibraryHooks(async () => {
			const added = await addLibraryText({
				filename: "keep.md",
				content: "keep me",
				source: "ui",
				waitForIndex: true,
			});
			const opened = openLibraryItem(added.item.id);
			expect(opened.extractedText).toContain("keep me");
			expect(removeLibraryItem(added.item.id)).toBe(true);
			expect(getLibraryItem(added.item.id)).toBeNull();
			expect(fs.existsSync(path.join(TMP_DIR, "library", added.item.id))).toBe(
				false,
			);
		});
	});

	it("updates title without rewriting the file", async () => {
		await withLibraryHooks(async () => {
			const added = await addLibraryText({
				filename: "draft.md",
				content: "draft body",
				source: "ui",
				waitForIndex: true,
			});
			const updated = await updateLibraryItem(added.item.id, {
				title: "Final draft",
			});
			expect(updated.title).toBe("Final draft");
			expect(updated.contentHash).toBe(added.item.contentHash);
		});
	});

	it("dry-run tools preview without writing files", async () => {
		const { createLibraryTools } = await import("@toby/core/library/tools");
		const appliedActions: string[] = [];
		const tools = createLibraryTools({ dryRun: true, appliedActions });
		const execute = tools.add_to_library?.execute as
			| ((input: { filename: string; content?: string }) => Promise<{
					dryRun?: boolean;
					message?: string;
			  }>)
			| undefined;
		const find = tools.find_in_library?.execute as
			| ((input: { query?: string }) => Promise<{ dryRun?: boolean }>)
			| undefined;
		const remove = tools.remove_from_library?.execute as
			| ((input: { id: string }) => Promise<{ dryRun?: boolean }>)
			| undefined;
		expect(
			(await execute?.({ filename: "note.md", content: "hello" }))?.dryRun,
		).toBe(true);
		expect((await find?.({ query: "hello" }))?.dryRun).toBe(true);
		expect((await find?.({} as { query?: string }))?.dryRun).toBe(true);
		expect((await remove?.({ id: "missing" }))?.dryRun).toBe(true);
		expect(listLibraryItems()).toHaveLength(0);
		expect(appliedActions).toEqual([]);
	});

	it("lists documents and images when asked for the full catalog", async () => {
		await withLibraryHooks(async () => {
			await addLibraryText({
				filename: "note.md",
				content: "hello",
				source: "ui",
				waitForIndex: true,
			});
			const png = Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==",
				"base64",
			);
			await addLibraryBytes({
				filename: "shot.png",
				bytes: png,
				mediaType: "image/png",
				source: "ui",
				waitForIndex: true,
			});
			const { createLibraryTools } = await import("@toby/core/library/tools");
			const tools = createLibraryTools({ dryRun: false, appliedActions: [] });
			const find = tools.find_in_library?.execute as
				| ((input: {
						query?: string;
				  }) => Promise<{
						listed?: boolean;
						total?: number;
						items?: { filename: string; mimeType: string }[];
				  }>)
				| undefined;
			const listed = await find?.({});
			expect(listed?.listed).toBe(true);
			expect(listed?.total).toBe(2);
			const names = listed?.items?.map((item) => item.filename) ?? [];
			expect(names).toContain("note.md");
			expect(names).toContain("shot.png");
			expect(listed?.items?.some((item) => item.mimeType === "image/png")).toBe(
				true,
			);

			const listedByPhrase = await find?.({
				query: "list everything in my library",
			});
			expect(listedByPhrase?.listed).toBe(true);
			expect(listedByPhrase?.total).toBe(2);
		});
	});
});
