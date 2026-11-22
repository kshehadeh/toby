import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { graphSnapshot } from "@toby/core/graph/snapshot";
import { findNode } from "@toby/core/graph/store";
import { writeGraph } from "@toby/core/graph/write";
import { closeMemoryDbForTests } from "@toby/core/memory/memory-store";
import { ingestObservation } from "@toby/core/observations/ingest";
import { handleWebRequest } from "@toby/core/web/routes";

const isBun =
	typeof (globalThis as unknown as { Bun?: unknown }).Bun !== "undefined";

let dir = "";

beforeEach(() => {
	dir = path.join(os.tmpdir(), `toby-graph-snapshot-${randomUUID()}`);
	fs.mkdirSync(dir, { recursive: true });
	process.env.TOBY_DIR = dir;
});

afterEach(() => {
	closeMemoryDbForTests();
	fs.rmSync(dir, { recursive: true, force: true });
	Reflect.deleteProperty(process.env, "TOBY_DIR");
});

const self = { emails: ["me@example.com"], handles: [] };

function ingestEmail(id: string, from: string, to: string, threadId?: string) {
	return ingestObservation(
		"plugin:email",
		{
			externalId: id,
			kind: "email.message",
			...(threadId ? { threadId } : {}),
			direction: "inbound" as const,
			occurredAt: "2026-11-22T10:00:00.000Z",
			title: `Message ${id}`,
			actors: [
				{ role: "from" as const, email: from },
				{ role: "to" as const, email: to },
			],
		},
		self,
	);
}

function idOf(type: "person" | "thread", key: string): string {
	const node = findNode({ type, key });
	if (!node) throw new Error(`missing ${type} ${key}`);
	return node.id;
}

describe.skipIf(!isBun)("graph snapshot", () => {
	it("hides observations and links people through their threads", () => {
		ingestEmail("m-1", "dana@acme.com", "me@example.com", "t-1");
		ingestEmail("m-2", "dana@acme.com", "me@example.com", "t-1");

		const snap = graphSnapshot();
		expect(snap.nodes.some((n) => n.type === "observation")).toBe(false);
		const thread = idOf("thread", "plugin:email:t-1");
		const dana = idOf("person", "email:dana@acme.com");
		const shared = snap.edges.find(
			(e) =>
				e.type === "shared_activity" &&
				[e.src, e.dst].includes(thread) &&
				[e.src, e.dst].includes(dana),
		);
		expect(shared?.occurrences).toBe(2);
		expect(shared?.origin).toBe("derived");
	});

	it("links people pairwise when an observation has no thread", () => {
		ingestEmail("m-1", "dana@acme.com", "me@example.com");
		const snap = graphSnapshot();
		const dana = idOf("person", "email:dana@acme.com");
		const me = idOf("person", "email:me@example.com");
		expect(
			snap.edges.some(
				(e) => [e.src, e.dst].includes(dana) && [e.src, e.dst].includes(me),
			),
		).toBe(true);
	});

	it("returns raw observation edges when observations are requested", () => {
		ingestEmail("m-1", "dana@acme.com", "me@example.com", "t-1");
		const snap = graphSnapshot({ types: ["person", "observation", "thread"] });
		expect(snap.nodes.some((n) => n.type === "observation")).toBe(true);
		expect(snap.edges.some((e) => e.type === "shared_activity")).toBe(false);
		expect(snap.edges.map((e) => e.type)).toContain("sent");
	});

	it("never returns private or unconfirmed nodes", () => {
		writeGraph({
			nodes: [
				{ type: "topic", key: "open", label: "Open" },
				{
					type: "topic",
					key: "secret",
					label: "Secret",
					visibility: "private",
				},
				{
					type: "topic",
					key: "ask",
					label: "Ask",
					visibility: "requires_confirmation",
				},
			],
		});
		const labels = graphSnapshot().nodes.map((n) => n.label);
		expect(labels).toEqual(["Open"]);
	});

	it("ranks by degree and reports truncation", () => {
		ingestEmail("m-1", "dana@acme.com", "me@example.com", "t-1");
		ingestEmail("m-2", "lee@acme.com", "me@example.com", "t-2");
		const snap = graphSnapshot({ limit: 1 });
		expect(snap.nodes).toHaveLength(1);
		expect(snap.nodes[0]?.id).toBe(idOf("person", "email:me@example.com"));
		expect(snap.truncated).toBe(true);
	});

	it("serves the snapshot over the API and rejects bad types", async () => {
		ingestEmail("m-1", "dana@acme.com", "me@example.com", "t-1");
		const ok = await handleWebRequest(
			new Request("http://localhost/api/graph?types=person,thread&limit=10"),
		);
		expect(ok.status).toBe(200);
		const body = (await ok.json()) as {
			nodes: Array<{ type: string }>;
			totals: { nodes: number };
		};
		expect(body.nodes.every((n) => ["person", "thread"].includes(n.type))).toBe(
			true,
		);
		expect(body.totals.nodes).toBeGreaterThan(0);
		const bad = await handleWebRequest(
			new Request("http://localhost/api/graph?types=nope"),
		);
		expect(bad.status).toBe(400);
	});
});
