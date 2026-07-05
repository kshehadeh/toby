import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	closeChatDbForTests,
	loadRoutingEmbeddings,
	upsertRoutingEmbedding,
} from "@toby/core/session-store";

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

describe.skipIf(!isBun)("routing_embeddings store", () => {
	afterEach(() => {
		closeChatDbForTests();
		const dir = process.env.TOBY_DIR;
		if (dir && fs.existsSync(dir)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
		process.env.TOBY_DIR = undefined;
	});

	it("persists and loads vectors by catalog signature", () => {
		process.env.TOBY_DIR = fs.mkdtempSync(
			path.join(os.tmpdir(), "toby-routing-index-test-"),
		);

		upsertRoutingEmbedding({
			entityType: "tool",
			entityId: "gmailSearch",
			catalogSignature: "sig-a",
			model: "text-embedding-3-small",
			vector: [1, 0, 0.5],
		});
		upsertRoutingEmbedding({
			entityType: "skill",
			entityId: "inbox-triage",
			catalogSignature: "sig-a",
			model: "text-embedding-3-small",
			vector: [0, 1, 0],
		});

		const loaded = loadRoutingEmbeddings({
			catalogSignature: "sig-a",
			model: "text-embedding-3-small",
		});
		expect(loaded).toHaveLength(2);
		const gmail = loaded.find(
			(r) => r.entityType === "tool" && r.entityId === "gmailSearch",
		);
		expect(gmail?.vector[0]).toBeCloseTo(1, 4);
		expect(gmail?.vector[2]).toBeCloseTo(0.5, 4);

		const other = loadRoutingEmbeddings({
			catalogSignature: "sig-b",
			model: "text-embedding-3-small",
		});
		expect(other).toHaveLength(0);
	});
});
