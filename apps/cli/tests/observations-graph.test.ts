import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeConfig } from "@toby/core/config/index";
import {
	createFollowupLoop,
	updateFollowupLoop,
} from "@toby/core/followups/store";
import {
	runGraphEnrichment,
	semanticMatches,
} from "@toby/core/graph/enrichment";
import { backfillMemoryGraph } from "@toby/core/graph/memory-backfill";
import {
	edgesTouching,
	findNode,
	getNode,
	upsertEdgeByIds,
} from "@toby/core/graph/store";
import { writeGraph } from "@toby/core/graph/write";
import { closeMemoryDbForTests, getDb } from "@toby/core/memory/memory-store";
import { ingestObservation } from "@toby/core/observations/ingest";
import { pruneObservations } from "@toby/core/observations/run";
import { tobyChatSource } from "@toby/core/observations/sources";
import {
	findObservation,
	getObservationByNode,
} from "@toby/core/observations/store";
import {
	closeChatDbForTests,
	createChatSession,
	replaceSessionMessages,
} from "@toby/core/session-store";

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
let dir = "";

beforeEach(() => {
	dir = path.join(os.tmpdir(), `toby-observations-test-${randomUUID()}`);
	fs.mkdirSync(dir, { recursive: true });
	process.env.TOBY_DIR = dir;
});

afterEach(() => {
	closeChatDbForTests();
	closeMemoryDbForTests();
	fs.rmSync(dir, { recursive: true, force: true });
	Reflect.deleteProperty(process.env, "TOBY_DIR");
});

describe.skipIf(!isBun)("observation ingestion", () => {
	it("does not turn old chat turns into new completion evidence on a later session update", async () => {
		const session = createChatSession();
		replaceSessionMessages(session.id, [
			{ role: "user", content: "I sent Dana the deck" },
		]);
		const first = await tobyChatSource.collect({
			since: "2000-01-01T00:00:00.000Z",
		});
		const input = first.observations[0];
		if (!input) throw new Error("Expected chat observation");
		const oldAt = "2026-01-01T00:00:00.000Z";
		ingestObservation(
			tobyChatSource.id,
			{ ...input, occurredAt: oldAt },
			{ emails: [], handles: [] },
		);
		replaceSessionMessages(session.id, [
			{ role: "user", content: "I sent Dana the deck" },
			{ role: "user", content: "What is on my calendar?" },
		]);
		const later = await tobyChatSource.collect({
			since: "2000-01-01T00:00:00.000Z",
		});
		expect(later.observations[0]?.occurredAt).toBe(oldAt);
		expect(later.observations[1]?.occurredAt).not.toBe(oldAt);
	});

	it("bounds UTF-8 excerpts to 2 KB without splitting characters", () => {
		for (const [index, excerpt] of [
			"x".repeat(3000),
			"漢".repeat(1000),
			"🟠".repeat(1000),
		].entries()) {
			const result = ingestObservation(
				"test",
				{
					externalId: `unicode-${index}`,
					kind: "chat.message",
					occurredAt: new Date().toISOString(),
					title: "Unicode",
					excerpt,
					actors: [],
				},
				{ emails: [], handles: [] },
			);
			const stored = result.observation.excerpt ?? "";
			expect(Buffer.byteLength(stored, "utf8")).toBeLessThanOrEqual(2000);
			expect(stored).not.toContain("\uFFFD");
			expect(excerpt.startsWith(stored)).toBe(true);
		}
	});

	it("writes message, thread, sender, recipient, and cc edges idempotently", () => {
		const input = {
			externalId: "m-1",
			kind: "email.message",
			threadId: "t-1",
			direction: "inbound" as const,
			occurredAt: "2026-11-22T10:00:00.000Z",
			title: "Project update",
			excerpt: "Can you review this before Friday?",
			actors: [
				{ role: "from" as const, email: "dana@acme.com", name: "Dana" },
				{ role: "to" as const, email: "me@example.com", name: "You" },
				{ role: "cc" as const, email: "lee@acme.com", name: "Lee" },
			],
		};
		const first = ingestObservation("plugin:email", input, {
			emails: ["me@example.com"],
			handles: [],
		});
		const again = ingestObservation("plugin:email", input, {
			emails: ["me@example.com"],
			handles: [],
		});
		expect(first.status).toBe("new");
		expect(again.status).toBe("unchanged");
		expect(again.observation.nodeId).toBe(first.observation.nodeId);
		expect(findObservation("plugin:email", "m-1")?.excerpt).toContain("review");

		const messageNode = getNode(first.observation.nodeId);
		const threadNode = findNode({ type: "thread", key: "plugin:email:t-1" });
		const dana = findNode({ type: "person", key: "email:dana@acme.com" });
		const self = findNode({ type: "person", key: "email:me@example.com" });
		const lee = findNode({ type: "person", key: "email:lee@acme.com" });
		expect(messageNode?.props.direction).toBe("inbound");
		expect(threadNode).not.toBeNull();
		expect(
			edgesTouching([messageNode?.id as string])
				.map((edge) => edge.type)
				.sort(),
		).toEqual(["in_thread", "received", "received", "sent"]);
		expect(edgesTouching([dana?.id as string])[0]?.type).toBe("sent");
		expect(edgesTouching([self?.id as string])[0]?.weight).toBe(1);
		expect(edgesTouching([lee?.id as string])[0]?.weight).toBe(0.6);
	});

	it("updates changed content and ignores invalid batch items", async () => {
		const base = {
			externalId: "same",
			kind: "email.message",
			occurredAt: "2026-11-22T10:00:00.000Z",
			title: "Hi",
			actors: [],
		};
		ingestObservation("plugin:email", base, { emails: [], handles: [] });
		const update = ingestObservation(
			"plugin:email",
			{ ...base, title: "Updated" },
			{ emails: [], handles: [] },
		);
		expect(update.status).toBe("updated");
		expect(findObservation("plugin:email", "same")?.title).toBe("Updated");
	});
});

describe.skipIf(!isBun)("graph enrichment", () => {
	it("removes stale semantic links when a node is re-embedded", async () => {
		const now = new Date(Date.now() + 1000);
		const [first, second] = writeGraph({
			nodes: [
				{
					type: "observation",
					key: "changed",
					label: "Old topic",
					props: { occurredAt: now.toISOString() },
				},
				{
					type: "observation",
					key: "unrelated",
					label: "Other topic",
					props: { occurredAt: now.toISOString() },
				},
			],
		}).nodeIds;
		if (!first || !second) throw new Error("Expected graph nodes");
		writeGraph({
			nodes: [
				{
					type: "observation",
					key: "changed",
					label: "Old topic",
					props: { occurredAt: now.toISOString() },
				},
			],
			enrich: ["embed"],
		});
		upsertEdgeByIds(first, second, {
			type: "related_to",
			origin: "semantic",
			weight: 0.95,
			confidence: 0.95,
		});
		await runGraphEnrichment({
			now,
			embed: async () => ({ vector: [0, 1], model: "test-embed" }),
		});
		expect(edgesTouching([first], { edgeTypes: ["related_to"] })).toHaveLength(
			0,
		);
	});

	it("backfills existing memories but never exposes private memory subjects", () => {
		const db = getDb();
		const now = new Date().toISOString();
		for (const item of [
			{ id: "legacy-usable", subject: "Dana", visibility: "usable_by_ai" },
			{ id: "legacy-private", subject: "Secret Person", visibility: "private" },
		]) {
			db.query(`INSERT INTO memory_items(id, user_id, type, subject, value, confidence, sensitivity, visibility, expires_at, content_hash, created_at, updated_at)
				VALUES($id, 'u1', 'fact', $subject, 'Memory text', 1, 'normal', $visibility, NULL, $hash, $now, $now)`).run(
				{
					$id: item.id,
					$subject: item.subject,
					$visibility: item.visibility,
					$hash: item.id,
					$now: now,
				},
			);
		}
		const result = backfillMemoryGraph();
		expect(result).toEqual({ queued: 1, complete: true });
		expect(findNode({ type: "memory", key: "legacy-usable" })?.visibility).toBe(
			"usable_by_ai",
		);
		expect(
			findNode({ type: "memory", key: "legacy-private" })?.visibility,
		).toBe("private");
		expect(findNode({ type: "person", key: "name:dana" })).not.toBeNull();
		expect(findNode({ type: "person", key: "name:secret person" })).toBeNull();
	});

	it("adds only top-five semantic edges at or above threshold", () => {
		const candidates = Array.from({ length: 7 }, (_, index) => ({
			id: `n${index}`,
			vector: [1, index < 5 ? 0 : 1],
		}));
		const result = semanticMatches({
			nodeId: "self",
			vector: [1, 0],
			candidates,
			threshold: 0.8,
		});
		expect(result.map((item) => item.id)).toHaveLength(5);
		expect(result.every((item) => item.score >= 0.8)).toBe(true);
	});

	it("extracts entities without an available embedding model", async () => {
		const now = new Date(Date.now() + 1000);
		const [id] = writeGraph({
			nodes: [
				{
					type: "observation",
					key: "no-embed",
					label: "Dana delivered the deck",
				},
			],
			enrich: ["embed", "extract"],
		}).nodeIds;
		let calls = 0;
		await runGraphEnrichment({
			now,
			embed: async () => null,
			extract: async (nodes) => {
				calls++;
				return {
					entities: [],
					links: [
						{
							nodeId: nodes[0]?.id,
							entity: {
								type: "person",
								name: "Dana",
								identifiers: ["dana@example.com"],
								confidence: 0.9,
							},
							edgeType: "mentions",
						},
					],
				};
			},
		});
		expect(calls).toBe(1);
		expect(
			edgesTouching([id as string]).some((edge) => edge.type === "mentions"),
		).toBe(true);
	});

	it("embeds nodes, links similar evidence, extracts entities, and honors daily budget", async () => {
		const now = new Date(Date.now() + 1000);
		const [older] = writeGraph({
			nodes: [
				{
					type: "observation",
					key: "old",
					label: "deck",
					props: {
						occurredAt: new Date(now.getTime() - 86_400_000).toISOString(),
					},
				},
			],
		}).nodeIds;
		getDb()
			.query(
				"INSERT INTO graph_embeddings(node_id, embedding_blob, model, created_at) VALUES($id, $blob, $model, $at)",
			)
			.run({
				$id: older,
				$blob: Buffer.from(new Float32Array([1, 0]).buffer),
				$model: "test-embed",
				$at: new Date().toISOString(),
			});
		const [current] = writeGraph({
			nodes: [
				{
					type: "observation",
					key: "new",
					label: "Dana sent deck",
					props: { occurredAt: now.toISOString(), text: "Dana sent the deck" },
				},
			],
			enrich: ["embed", "extract"],
		}).nodeIds;
		let extractedNodes = 0;
		const stats = await runGraphEnrichment({
			now,
			embed: async () => ({ vector: [1, 0], model: "test-embed" }),
			extract: async (nodes) => {
				extractedNodes = nodes.length;
				return {
					entities: [],
					links: [
						{
							nodeId: nodes[0]?.id,
							entity: {
								type: "person",
								name: "Dana",
								identifiers: ["dana@example.com"],
								confidence: 0.9,
							},
							edgeType: "mentions",
						},
					],
				};
			},
		});
		expect(stats.semanticEdges).toBe(1);
		expect(stats.extracted).toBe(1);
		expect(extractedNodes).toBe(1);
		expect(
			edgesTouching([current as string]).some(
				(edge) => edge.type === "related_to" && edge.weight === 1,
			),
		).toBe(true);
		expect(
			findNode({ type: "person", key: "email:dana@example.com" }),
		).not.toBeNull();

		const [entityOnly] = writeGraph({
			nodes: [
				{
					type: "observation",
					key: "entity-only",
					label: "Discussed launch plan",
					props: { occurredAt: now.toISOString() },
				},
			],
			enrich: ["embed", "extract"],
		}).nodeIds;
		const entityStats = await runGraphEnrichment({
			now: new Date(now.getTime() + 100),
			embed: async () => ({ vector: [0, 1], model: "test-embed" }),
			extract: async () => ({
				entities: [{ type: "project", name: "Launch plan", confidence: 0.9 }],
				links: [],
			}),
		});
		expect(entityStats.extracted).toBe(1);
		expect(
			findNode({ type: "project", key: "name:launch plan" }),
		).not.toBeNull();
		expect(entityOnly).toBeDefined();

		writeConfig({
			integrations: {},
			personas: [],
			graph: { maxExtractionsPerDay: 0 },
		});
		const [budgeted] = writeGraph({
			nodes: [{ type: "observation", key: "budgeted", label: "Budget" }],
			enrich: ["embed", "extract"],
		}).nodeIds;
		let calls = 0;
		await runGraphEnrichment({
			now: new Date(Date.now() + 2000),
			embed: async () => ({ vector: [0, 1], model: "test-embed" }),
			extract: async () => {
				calls++;
				return { entities: [], links: [] };
			},
		});
		expect(calls).toBe(0);
		expect(budgeted).toBeDefined();
	});
});

describe.skipIf(!isBun)("observation retention", () => {
	it("keeps evidence for open loops but prunes evidence for resolved loops", () => {
		const now = new Date();
		const occurredAt = new Date(now.getTime() - 46 * 86_400_000);
		const input = (externalId: string) =>
			ingestObservation(
				"plugin:email",
				{
					externalId,
					kind: "email.message",
					occurredAt: occurredAt.toISOString(),
					title: externalId,
					actors: [],
				},
				{ emails: [], handles: [] },
				occurredAt,
			).observation;
		const openEvidence = input("open-evidence");
		const resolvedEvidence = input("resolved-evidence");
		const openNode = {
			type: "loop" as const,
			key: "retention-open",
			label: "Open",
			props: { status: "open" },
		};
		const resolvedNode = {
			type: "loop" as const,
			key: "retention-resolved",
			label: "Resolved",
			props: { status: "resolved" },
		};
		const [openId, resolvedId] = writeGraph({
			nodes: [openNode, resolvedNode],
		}).nodeIds;
		if (!openId || !resolvedId)
			throw new Error("Expected retention loop nodes");
		createFollowupLoop({
			loopId: openId,
			kind: "commitment",
			fingerprint: "retention-open",
			title: "Open",
			confidence: 0.9,
			lastActivityAt: occurredAt.toISOString(),
		});
		createFollowupLoop({
			loopId: resolvedId,
			kind: "commitment",
			fingerprint: "retention-resolved",
			title: "Resolved",
			confidence: 0.9,
			lastActivityAt: occurredAt.toISOString(),
		});
		updateFollowupLoop(resolvedId, { status: "resolved" });
		upsertEdgeByIds(openId, openEvidence.nodeId, {
			type: "evidence_for",
			origin: "extracted",
			weight: 0.9,
			confidence: 0.9,
		});
		upsertEdgeByIds(resolvedId, resolvedEvidence.nodeId, {
			type: "evidence_for",
			origin: "extracted",
			weight: 0.9,
			confidence: 0.9,
		});

		expect(pruneObservations(now)).toBe(1);
		expect(getObservationByNode(openEvidence.nodeId)).not.toBeNull();
		expect(getObservationByNode(resolvedEvidence.nodeId)).toBeNull();
	});
});
