import {
	closeChatDbForTests,
	loadRoutingEmbeddings,
	upsertRoutingEmbedding,
} from "@toby/core/session-store";
import { afterEach, describe, expect, it } from "vitest";

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

describe.skipIf(!isBun)("routing_embeddings store", () => {
	afterEach(() => {
		closeChatDbForTests();
	});

	it("persists and loads vectors by catalog signature", () => {
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
