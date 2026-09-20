import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runWithMemoryEmbedTestHooks } from "@toby/core/memory/embeddings";
import * as memory from "@toby/core/memory/memory-service";
import {
	closeMemoryDbForTests,
	getAuditEntriesForMemory,
	getEmbedding,
	listEmbeddingsForUser,
} from "@toby/core/memory/memory-store";
import { formatMemoryEmbedText } from "@toby/core/memory/text";
import { handleMemoriesList } from "@toby/core/web/handlers/memories";
import {
	embedVectorByText,
	stubEmbedTexts,
} from "./helpers/setup-memory-embed-mocks";

const isBun =
	typeof (globalThis as unknown as { Bun?: unknown }).Bun !== "undefined";

const TMP_DIR = path.join(
	os.tmpdir(),
	`toby-memory-embed-test-${randomUUID()}`,
);

function withEmbeds(run: () => Promise<void>): Promise<void> {
	embedVectorByText.clear();
	return runWithMemoryEmbedTestHooks(
		{
			resolveEmbedder: () => ({
				model: {} as never,
				modelId: "test-embed-model",
			}),
			embedTexts: stubEmbedTexts,
		},
		run,
	);
}

beforeEach(() => {
	fs.mkdirSync(TMP_DIR, { recursive: true });
	process.env.TOBY_DIR = TMP_DIR;
});

afterEach(() => {
	closeMemoryDbForTests();
	try {
		fs.rmSync(TMP_DIR, { recursive: true, force: true });
	} catch {
		// ignore
	}
	Reflect.deleteProperty(process.env, "TOBY_DIR");
});

describe.skipIf(!isBun)("memory embeddings", () => {
	it("finds a memory by meaning when keywords do not overlap", async () => {
		await withEmbeds(async () => {
			embedVectorByText.set(
				formatMemoryEmbedText({ value: "Lives in Baltimore, Maryland" }),
				[1, 0, 0],
			);
			embedVectorByText.set("where is my home", [0.99, 0.1, 0]);

			await memory.createManual("user1", {
				value: "Lives in Baltimore, Maryland",
			});
			const results = await memory.search("user1", "where is my home");
			expect(results).toHaveLength(1);
			expect(results[0]?.value).toBe("Lives in Baltimore, Maryland");
		});
	});

	it("merges near-duplicate wording and keeps the existing value", async () => {
		await withEmbeds(async () => {
			embedVectorByText.set(
				formatMemoryEmbedText({ value: "Prefers dark mode" }),
				[1, 0, 0],
			);
			embedVectorByText.set(
				formatMemoryEmbedText({ value: "I like using dark mode" }),
				[0.9, 0.43589, 0],
			);

			const first = await memory.createManual("user1", {
				value: "Prefers dark mode",
				type: "preference",
			});
			const second = await memory.createManual("user1", {
				value: "I like using dark mode",
				type: "preference",
			});
			expect(second.id).toBe(first.id);
			expect(second.value).toBe("Prefers dark mode");
			expect(memory.countMemoryItems("user1")).toBe(1);
			const audit = getAuditEntriesForMemory(first.id);
			expect(audit.some((e) => e.action === "merged")).toBe(true);
		});
	});

	it("updates value when the near-duplicate is strictly more specific", async () => {
		await withEmbeds(async () => {
			embedVectorByText.set(
				formatMemoryEmbedText({ value: "Lives in Baltimore" }),
				[1, 0, 0],
			);
			embedVectorByText.set(
				formatMemoryEmbedText({ value: "Lives in Baltimore, Maryland" }),
				[0.9, 0.43589, 0],
			);

			const first = await memory.createManual("user1", {
				value: "Lives in Baltimore",
			});
			const second = await memory.createManual("user1", {
				value: "Lives in Baltimore, Maryland",
			});
			expect(second.id).toBe(first.id);
			expect(second.value).toBe("Lives in Baltimore, Maryland");
		});
	});

	it("does not merge different types below the near-exact threshold", async () => {
		await withEmbeds(async () => {
			embedVectorByText.set(
				formatMemoryEmbedText({ value: "Prefers dark mode" }),
				[1, 0, 0],
			);
			embedVectorByText.set(
				formatMemoryEmbedText({ value: "Uses a dark color theme" }),
				[0.9, 0.43589, 0],
			);

			await memory.createManual("user1", {
				value: "Prefers dark mode",
				type: "preference",
			});
			await memory.createManual("user1", {
				value: "Uses a dark color theme",
				type: "fact",
			});
			expect(memory.countMemoryItems("user1")).toBe(2);
		});
	});

	it("does not return private memories from retrieveForTask via embeddings", async () => {
		await withEmbeds(async () => {
			embedVectorByText.set(
				formatMemoryEmbedText({ value: "SSN is secret" }),
				[1, 0, 0],
			);
			embedVectorByText.set("secret identifier", [1, 0, 0]);

			await memory.createManual("user1", {
				value: "SSN is secret",
				visibility: "private",
			});
			const bundle = await memory.retrieveForTask("user1", "secret identifier");
			expect(bundle.memories).toHaveLength(0);
		});
	});

	it("stores an embedding on save and re-embeds on update", async () => {
		await withEmbeds(async () => {
			embedVectorByText.set(
				formatMemoryEmbedText({ value: "Drinks tea" }),
				[0, 1, 0],
			);
			embedVectorByText.set(
				formatMemoryEmbedText({ value: "Drinks coffee" }),
				[0, 0, 1],
			);

			const item = await memory.createManual("user1", { value: "Drinks tea" });
			const stored = getEmbedding(item.id);
			expect(stored).not.toBeNull();
			expect(stored?.model).toBe("test-embed-model");
			expect(listEmbeddingsForUser("user1")).toHaveLength(1);

			await memory.update("user1", item.id, { value: "Drinks coffee" });
			expect(listEmbeddingsForUser("user1")).toHaveLength(1);
			const after = getEmbedding(item.id);
			expect(after).not.toBeNull();
			expect(after?.model).toBe("test-embed-model");
		});
	});

	it("uses hybrid search on GET /api/memories?q=", async () => {
		await withEmbeds(async () => {
			embedVectorByText.set(
				formatMemoryEmbedText({ value: "Lives in Baltimore, Maryland" }),
				[1, 0, 0],
			);
			embedVectorByText.set("home city", [0.99, 0.1, 0]);

			await memory.createManual("default", {
				value: "Lives in Baltimore, Maryland",
			});
			const url = new URL("http://127.0.0.1/api/memories?q=home%20city");
			const res = await handleMemoriesList(url);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				memories: Array<{ value: string }>;
			};
			expect(body.memories[0]?.value).toBe("Lives in Baltimore, Maryland");
		});
	});
});
