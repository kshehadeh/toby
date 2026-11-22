import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emailFromAddressLine, emailPersonKey } from "@toby/core/graph/keys";
import { contextFor, neighbors } from "@toby/core/graph/query";
import {
	completeEnrichment,
	deleteNode,
	dueEnrichment,
	edgesTouching,
	enqueueEnrichment,
	failEnrichment,
	findNode,
	getNode,
	graphCounts,
} from "@toby/core/graph/store";
import { writeGraph } from "@toby/core/graph/write";
import * as memory from "@toby/core/memory/memory-service";
import { closeMemoryDbForTests } from "@toby/core/memory/memory-store";
import { ingestObservation } from "@toby/core/observations/ingest";
import { memorySource } from "@toby/core/observations/sources";
import { findObservation } from "@toby/core/observations/store";

const isBun =
	typeof (globalThis as unknown as { Bun?: unknown }).Bun !== "undefined";

let dir = "";

beforeEach(() => {
	dir = path.join(os.tmpdir(), `toby-graph-test-${randomUUID()}`);
	fs.mkdirSync(dir, { recursive: true });
	process.env.TOBY_DIR = dir;
});

afterEach(() => {
	closeMemoryDbForTests();
	fs.rmSync(dir, { recursive: true, force: true });
	Reflect.deleteProperty(process.env, "TOBY_DIR");
});

const dana = {
	type: "person",
	key: emailPersonKey("Dana@Acme.com"),
	label: "Dana",
} as const;
const thread = { type: "thread", key: "email:t1", label: "Q3 deck" } as const;

function message(id: string) {
	return {
		type: "observation",
		key: `email:${id}`,
		label: `msg ${id}`,
	} as const;
}

describe.skipIf(!isBun)("graph store", () => {
	it("upserts nodes by type and key and merges props", () => {
		const [first] = writeGraph({
			nodes: [{ ...dana, props: { a: 1 } }],
		}).nodeIds;
		const [second] = writeGraph({
			nodes: [{ type: "person", key: dana.key, props: { b: 2 } }],
		}).nodeIds;
		expect(second).toBe(first);
		const node = getNode(first as string);
		expect(node?.label).toBe("Dana");
		expect(node?.props).toEqual({ a: 1, b: 2 });
		expect(graphCounts().nodes).toBe(1);
	});

	it("creates edge endpoints on write and strengthens repeated edges", () => {
		writeGraph({
			nodes: [message("m1")],
			edges: [
				{ src: dana, dst: message("m1"), type: "sent", weight: 0.5 },
				{ src: message("m1"), dst: thread, type: "in_thread" },
			],
		});
		writeGraph({
			edges: [{ src: dana, dst: message("m1"), type: "sent", weight: 0.8 }],
		});
		const person = findNode(dana);
		const edges = edgesTouching([person?.id as string]);
		expect(edges).toHaveLength(1);
		expect(edges[0]?.weight).toBe(0.8);
		expect(edges[0]?.occurrences).toBe(2);
		expect(graphCounts()).toEqual({ nodes: 3, edges: 2 });
	});

	it("stores symmetric edges once regardless of direction", () => {
		const a = message("a");
		const b = message("b");
		writeGraph({
			edges: [{ src: a, dst: b, type: "related_to", weight: 0.9 }],
		});
		writeGraph({
			edges: [{ src: b, dst: a, type: "related_to", weight: 0.85 }],
		});
		expect(graphCounts().edges).toBe(1);
	});

	it("rolls back the whole write when one part fails", () => {
		expect(() =>
			writeGraph({
				nodes: [message("ok")],
				edges: [
					{
						src: message("ok"),
						dst: { type: "person", key: null as unknown as string },
						type: "sent",
					},
				],
			}),
		).toThrow();
		expect(graphCounts().nodes).toBe(0);
	});

	it("walks neighbors in both directions with depth, type filters, and scores", () => {
		writeGraph({
			edges: [
				{ src: dana, dst: message("m1"), type: "sent", weight: 1 },
				{ src: message("m1"), dst: thread, type: "in_thread", weight: 0.5 },
			],
		});
		const start = findNode(thread)?.id as string;
		const one = neighbors(start);
		expect(one.map((n) => n.node.key)).toEqual(["email:m1"]);
		const two = neighbors(start, { depth: 2, nodeTypes: ["person"] });
		expect(two).toHaveLength(1);
		expect(two[0]?.node.label).toBe("Dana");
		expect(two[0]?.depth).toBe(2);
		expect(two[0]?.score).toBeCloseTo(0.5);
		expect(neighbors(start, { edgeTypes: ["sent"] })).toHaveLength(0);
	});

	it("caps fan-out per node", () => {
		const edges = Array.from({ length: 30 }, (_, i) => ({
			src: dana,
			dst: message(`m${i}`),
			type: "sent" as const,
			weight: i / 30,
		}));
		writeGraph({ edges });
		const start = findNode(dana)?.id as string;
		const found = neighbors(start, { fanout: 5 });
		expect(found).toHaveLength(5);
		expect(found[0]?.via.weight).toBeCloseTo(29 / 30);
	});

	it("hides private and unconfirmed nodes and does not walk through them", () => {
		const secret = {
			type: "memory",
			key: "secret",
			label: "secret",
			visibility: "private",
		} as const;
		const pending = {
			type: "memory",
			key: "pending",
			label: "pending",
			visibility: "requires_confirmation",
		} as const;
		writeGraph({
			edges: [
				{ src: dana, dst: secret, type: "about" },
				{ src: secret, dst: thread, type: "about" },
				{ src: dana, dst: pending, type: "about" },
			],
		});
		const start = findNode(dana)?.id as string;
		expect(neighbors(start, { depth: 3 }).map((n) => n.node.key)).toEqual([]);
		expect(neighbors(findNode(secret)?.id as string)).toHaveLength(0);
		expect(
			neighbors(start, { depth: 3, includeUnconfirmed: true }).map(
				(n) => n.node.key,
			),
		).toEqual(["pending"]);
	});

	it("hides expired memory nodes", () => {
		writeGraph({
			edges: [
				{
					src: dana,
					dst: {
						type: "memory",
						key: "old",
						props: { expiresAt: "2000-01-01T00:00:00.000Z" },
					},
					type: "about",
				},
			],
		});
		expect(neighbors(findNode(dana)?.id as string)).toHaveLength(0);
	});

	it("renders a bounded prompt context", () => {
		writeGraph({
			edges: [
				{
					src: dana,
					dst: {
						type: "memory",
						key: "m",
						label: "Dana",
						props: { text: "Dana is my manager" },
					},
					type: "about",
				},
			],
		});
		const { text } = contextFor([findNode(dana)?.id as string]);
		expect(text).toContain("[memory] Dana: Dana is my manager (via about)");
		expect(
			contextFor([findNode(dana)?.id as string], { maxChars: 10 }).text,
		).toBe("");
	});

	it("deletes a node with its edges and queue entry", () => {
		const { nodeIds } = writeGraph({
			nodes: [message("m1")],
			edges: [{ src: dana, dst: message("m1"), type: "sent" }],
			enrich: ["embed"],
		});
		const id = nodeIds[0] as string;
		expect(deleteNode(id)).toBe(true);
		expect(graphCounts()).toEqual({ nodes: 1, edges: 0 });
		expect(dueEnrichment(10)).toHaveLength(0);
	});
});

describe.skipIf(!isBun)("enrichment queue", () => {
	it("merges steps, completes them, and backs off failures", () => {
		const id = writeGraph({ nodes: [message("q")] }).nodeIds[0] as string;
		enqueueEnrichment(id, ["embed"]);
		enqueueEnrichment(id, ["extract"]);
		expect(dueEnrichment(10)[0]?.steps).toEqual(["embed", "extract"]);
		completeEnrichment(id, ["embed"]);
		expect(dueEnrichment(10)[0]?.steps).toEqual(["extract"]);
		failEnrichment(id, "boom");
		expect(dueEnrichment(10)).toHaveLength(0);
		expect(
			dueEnrichment(10, new Date(Date.now() + 120_000).toISOString()),
		).toHaveLength(1);
		completeEnrichment(id, ["extract"]);
		expect(
			dueEnrichment(10, new Date(Date.now() + 1e9).toISOString()),
		).toHaveLength(0);
	});
});

describe.skipIf(!isBun)("memory hooks", () => {
	it("mirrors create, update, and forget into the graph", async () => {
		const item = await memory.createManual("u1", {
			type: "relationship",
			subject: "Dana",
			value: "Dana is my manager",
		});
		const node = findNode({ type: "memory", key: item.id });
		expect(node?.props.text).toBe("Dana is my manager");
		expect(node?.ref).toEqual({ table: "memory_items", id: item.id });
		expect(dueEnrichment(10).map((e) => e.nodeId)).toContain(
			node?.id as string,
		);
		const collectMemory = async () => {
			const result = await memorySource.collect({
				since: "2000-01-01T00:00:00.000Z",
			});
			const input = result.observations.find((o) => o.externalId === item.id);
			if (!input) throw new Error("Expected usable memory observation");
			return ingestObservation("memory", input, { emails: [], handles: [] })
				.observation;
		};
		const copied = await collectMemory();
		expect(copied.excerpt).toBe("Dana is my manager");

		await memory.update("u1", item.id, { visibility: "private" });
		expect(findObservation("memory", item.id)).toBeNull();
		expect(getNode(copied.nodeId)).toBeNull();
		expect(findNode({ type: "memory", key: item.id })?.visibility).toBe(
			"private",
		);
		expect(findNode({ type: "person", key: "name:dana" })).toBeNull();

		await memory.update("u1", item.id, { visibility: "usable_by_ai" });
		const recreated = await collectMemory();
		memory.forget("u1", item.id);
		expect(findNode({ type: "memory", key: item.id })).toBeNull();
		expect(findObservation("memory", item.id)).toBeNull();
		expect(getNode(recreated.nodeId)).toBeNull();
	});

	it("keeps expiration on memory observations and does not collect expired memories", async () => {
		const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
		const item = await memory.createManual("u1", {
			type: "fact",
			value: "Temporary context",
			expiresAt,
		});
		const result = await memorySource.collect({
			since: "2000-01-01T00:00:00.000Z",
		});
		const input = result.observations.find((o) => o.externalId === item.id);
		if (!input) throw new Error("Expected memory observation");
		const observation = ingestObservation("memory", input, {
			emails: [],
			handles: [],
		}).observation;
		expect(getNode(observation.nodeId)?.props.expiresAt).toBe(expiresAt);
		expect(
			contextFor([observation.nodeId], {
				now: new Date(Date.parse(expiresAt) + 1),
			}).text,
		).toBe("");
		await memory.update("u1", item.id, {
			expiresAt: "2000-01-01T00:00:00.000Z",
		});
		expect(findObservation("memory", item.id)).toBeNull();
		const expired = await memorySource.collect({
			since: "2000-01-01T00:00:00.000Z",
		});
		expect(expired.observations).toHaveLength(0);
	});
});

describe("graph keys", () => {
	it("normalizes email addresses", () => {
		expect(emailFromAddressLine("Dana Smith <Dana@Acme.com>")).toBe(
			"dana@acme.com",
		);
		expect(emailFromAddressLine("bob@x.io")).toBe("bob@x.io");
		expect(emailFromAddressLine("no address")).toBeNull();
		expect(emailPersonKey(" A@B.com ")).toBe("email:a@b.com");
	});
});
