import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const isBun =
	typeof (globalThis as unknown as { Bun?: unknown }).Bun !== "undefined";
import {
	closeMemoryDbForTests,
	deleteItem,
	getAuditEntriesForMemory,
	getEmbedding,
	getItem,
	getItemSourceIds,
	getProposal,
	getSource,
	getSourcesForItem,
	insertAuditEntry,
	insertEmbedding,
	insertItem,
	insertProposal,
	insertSource,
	linkItemSource,
	searchItems,
	updateItem,
	updateProposalStatus,
} from "../src/memory/memory-store";

const TMP_DIR = path.join(
	os.tmpdir(),
	`toby-memory-store-test-${randomUUID()}`,
);

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
	process.env.TOBY_DIR = undefined;
});

describe.skipIf(!isBun)("memory-store", () => {
	describe("insertItem / getItem", () => {
		it("round-trips a memory item", () => {
			const item = insertItem(
				"user1",
				"preference",
				"email frequency",
				"I prefer daily digest emails",
				0.9,
				"normal",
				"usable_by_ai",
				null,
			);
			expect(item.id).toBeTruthy();
			expect(item.userId).toBe("user1");
			expect(item.type).toBe("preference");
			expect(item.value).toBe("I prefer daily digest emails");
			expect(item.confidence).toBe(0.9);

			const loaded = getItem("user1", item.id);
			expect(loaded).not.toBeNull();
			expect(loaded?.value).toBe("I prefer daily digest emails");
			expect(loaded?.sourceIds).toEqual([]);
		});

		it("returns null for non-existent item", () => {
			expect(getItem("user1", "nonexistent")).toBeNull();
		});

		it("scopes items by userId", () => {
			const item = insertItem(
				"user1",
				"fact",
				undefined,
				"some fact",
				0.8,
				"normal",
				"usable_by_ai",
				null,
			);
			expect(getItem("user2", item.id)).toBeNull();
		});
	});

	describe("updateItem", () => {
		it("updates specified fields", () => {
			const item = insertItem(
				"user1",
				"preference",
				"theme",
				"dark mode",
				0.7,
				"normal",
				"usable_by_ai",
				null,
			);
			const updated = updateItem("user1", item.id, {
				value: "light mode",
				confidence: 0.95,
			});
			expect(updated).not.toBeNull();
			expect(updated?.value).toBe("light mode");
			expect(updated?.confidence).toBe(0.95);
		});

		it("returns null for non-existent item", () => {
			expect(updateItem("user1", "nonexistent", { value: "x" })).toBeNull();
		});
	});

	describe("deleteItem", () => {
		it("deletes an existing item", () => {
			const item = insertItem(
				"user1",
				"fact",
				undefined,
				"to delete",
				0.5,
				"normal",
				"usable_by_ai",
				null,
			);
			expect(deleteItem("user1", item.id)).toBe(true);
			expect(getItem("user1", item.id)).toBeNull();
		});

		it("returns false for non-existent item", () => {
			expect(deleteItem("user1", "nonexistent")).toBe(false);
		});
	});

	describe("searchItems", () => {
		it("finds items by value", () => {
			insertItem(
				"user1",
				"preference",
				"email",
				"I prefer daily digest",
				0.9,
				"normal",
				"usable_by_ai",
				null,
			);
			insertItem(
				"user1",
				"fact",
				"work",
				"Works at Acme Corp",
				0.8,
				"normal",
				"usable_by_ai",
				null,
			);
			const results = searchItems("user1", "digest");
			expect(results).toHaveLength(1);
			expect(results[0]?.value).toContain("digest");
		});

		it("finds items by subject", () => {
			insertItem(
				"user1",
				"project",
				"Project Alpha",
				"Important project",
				0.9,
				"normal",
				"usable_by_ai",
				null,
			);
			const results = searchItems("user1", "Alpha");
			expect(results).toHaveLength(1);
		});

		it("scopes search by userId", () => {
			insertItem(
				"user1",
				"fact",
				undefined,
				"private fact",
				0.5,
				"normal",
				"usable_by_ai",
				null,
			);
			expect(searchItems("user2", "private")).toHaveLength(0);
		});
	});

	describe("sources", () => {
		it("inserts and retrieves a source", () => {
			const source = insertSource(
				"user1",
				"gmail",
				"msg-123",
				"https://mail.google.com/msg-123",
				"2025-01-01T00:00:00Z",
				"User said they prefer weekly reports",
				{ label: "work" },
			);
			expect(source.id).toBeTruthy();
			expect(source.system).toBe("gmail");

			const loaded = getSource(source.id);
			expect(loaded).not.toBeNull();
			expect(loaded?.sourceId).toBe("msg-123");
			expect(loaded?.metadata).toEqual({ label: "work" });
		});

		it("links sources to items", () => {
			const source = insertSource(
				"user1",
				"chat",
				undefined,
				undefined,
				"2025-01-01T00:00:00Z",
				"User mentioned preference",
				undefined,
			);
			const item = insertItem(
				"user1",
				"preference",
				"reports",
				"weekly reports",
				0.9,
				"normal",
				"usable_by_ai",
				null,
			);
			linkItemSource(item.id, source.id);

			expect(getItemSourceIds(item.id)).toEqual([source.id]);
			const sources = getSourcesForItem(item.id);
			expect(sources).toHaveLength(1);
			expect(sources[0]?.id).toBe(source.id);
		});
	});

	describe("proposals", () => {
		it("inserts and retrieves a proposal", () => {
			const source = insertSource(
				"user1",
				"gmail",
				undefined,
				undefined,
				"2025-01-01T00:00:00Z",
				"excerpt",
				undefined,
			);
			const candidate = {
				userId: "user1",
				type: "preference" as const,
				subject: "theme",
				value: "dark mode",
				confidence: 0.8,
				sensitivity: "normal" as const,
				visibility: "usable_by_ai" as const,
				expiresAt: null,
			};
			const proposal = insertProposal(
				"user1",
				JSON.stringify(candidate),
				source.id,
				0.8,
				"normal",
				"usable_by_ai",
				"User stated preference",
			);
			expect(proposal.status).toBe("pending");

			const loaded = getProposal("user1", proposal.id);
			expect(loaded).not.toBeNull();
			expect(loaded?.candidate.value).toBe("dark mode");
		});

		it("updates proposal status", () => {
			const source = insertSource(
				"user1",
				"manual",
				undefined,
				undefined,
				"2025-01-01T00:00:00Z",
				undefined,
				undefined,
			);
			const proposal = insertProposal(
				"user1",
				JSON.stringify({
					type: "fact",
					value: "x",
					confidence: 0.5,
					sensitivity: "normal",
					visibility: "usable_by_ai",
					expiresAt: null,
					userId: "user1",
				}),
				source.id,
				0.5,
				"normal",
				"usable_by_ai",
				"test",
			);
			updateProposalStatus("user1", proposal.id, "accepted");
			const loaded = getProposal("user1", proposal.id);
			expect(loaded?.status).toBe("accepted");
			expect(loaded?.resolvedAt).toBeTruthy();
		});

		it("records rejection reason", () => {
			const source = insertSource(
				"user1",
				"manual",
				undefined,
				undefined,
				"2025-01-01T00:00:00Z",
				undefined,
				undefined,
			);
			const proposal = insertProposal(
				"user1",
				JSON.stringify({
					type: "fact",
					value: "x",
					confidence: 0.5,
					sensitivity: "normal",
					visibility: "usable_by_ai",
					expiresAt: null,
					userId: "user1",
				}),
				source.id,
				0.5,
				"normal",
				"usable_by_ai",
				"test",
			);
			updateProposalStatus("user1", proposal.id, "rejected", "Not relevant");
			const loaded = getProposal("user1", proposal.id);
			expect(loaded?.status).toBe("rejected");
			expect(loaded?.rejectionReason).toBe("Not relevant");
		});
	});

	describe("audit log", () => {
		it("inserts and retrieves audit entries", () => {
			const item = insertItem(
				"user1",
				"preference",
				undefined,
				"test",
				0.9,
				"normal",
				"usable_by_ai",
				null,
			);
			insertAuditEntry("user1", item.id, "saved", { autoSaved: true });

			const entries = getAuditEntriesForMemory(item.id);
			expect(entries).toHaveLength(1);
			expect(entries[0]?.action).toBe("saved");
			expect(entries[0]?.detail).toEqual({ autoSaved: true });
		});
	});

	describe("embeddings", () => {
		it("inserts and retrieves an embedding", () => {
			const item = insertItem(
				"user1",
				"fact",
				undefined,
				"test embedding",
				0.8,
				"normal",
				"usable_by_ai",
				null,
			);
			const blob = Buffer.from([1, 2, 3, 4]);
			insertEmbedding(item.id, blob, "text-embedding-3-small");

			const emb = getEmbedding(item.id);
			expect(emb).not.toBeNull();
			expect(emb?.model).toBe("text-embedding-3-small");
			expect(Buffer.compare(emb?.blob, blob)).toBe(0);
		});

		it("returns null for non-existent embedding", () => {
			expect(getEmbedding("nonexistent")).toBeNull();
		});
	});

	describe("separation from chat DB", () => {
		it("uses memory.sqlite, not chat.sqlite", () => {
			insertItem(
				"user1",
				"fact",
				undefined,
				"memory isolation test",
				0.8,
				"normal",
				"usable_by_ai",
				null,
			);
			const memoryDbPath = path.join(TMP_DIR, "memory.sqlite");
			const chatDbPath = path.join(TMP_DIR, "chat.sqlite");
			expect(fs.existsSync(memoryDbPath)).toBe(true);
			expect(fs.existsSync(chatDbPath)).toBe(false);
		});
	});
});
