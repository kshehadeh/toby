import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeConfig } from "@toby/core/config/index";
import {
	recordFollowupNotUseful,
	reopenFollowupTodo,
	runFollowupsOnce,
} from "@toby/core/followups/scheduler";
import {
	getFollowupLoop,
	listFollowupLoops,
	updateFollowupLoop,
} from "@toby/core/followups/store";
import type { FollowupUnit } from "@toby/core/followups/types";
import { buildFollowupUnits } from "@toby/core/followups/units";
import { runGraphEnrichment } from "@toby/core/graph/enrichment";
import { rebuildGraph } from "@toby/core/graph/rebuild";
import { dueEnrichment, edgesTouching } from "@toby/core/graph/store";
import { writeGraph } from "@toby/core/graph/write";
import { closeMemoryDbForTests } from "@toby/core/memory/memory-store";
import {
	ingestObservation,
	observationContentHash,
} from "@toby/core/observations/ingest";
import { CURSOR_OVERLAP_MS, ingestSource } from "@toby/core/observations/run";
import type { ObservationSource } from "@toby/core/observations/sources";
import {
	findObservation,
	getCursor,
	listIngestedSince,
} from "@toby/core/observations/store";
import type { ObservationInput } from "@toby/core/observations/types";
import { closeChatDbForTests } from "@toby/core/session-store";
import { listTodos } from "@toby/core/todos/service";

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
let dir = "";

beforeEach(() => {
	dir = path.join(os.tmpdir(), `toby-followups-fixes-test-${randomUUID()}`);
	fs.mkdirSync(dir, { recursive: true });
	process.env.TOBY_DIR = dir;
	writeConfig({
		integrations: {},
		personas: [],
		followups: { maxEvaluationsPerDay: 200 },
	});
});

afterEach(() => {
	closeChatDbForTests();
	closeMemoryDbForTests();
	fs.rmSync(dir, { recursive: true, force: true });
	Reflect.deleteProperty(process.env, "TOBY_DIR");
});

function email(at: Date, id: string, threadId = "thread-1") {
	return ingestObservation(
		"plugin:email",
		{
			externalId: id,
			kind: "email.message",
			threadId,
			direction: "inbound",
			occurredAt: at.toISOString(),
			title: "Can you review the deck?",
			excerpt: "Please review the deck.",
			url: `https://mail.example/${id}`,
			actors: [
				{ role: "from", email: "dana@example.com", name: "Dana" },
				{ role: "to", email: "me@example.com", name: "Me" },
			],
		},
		{ emails: ["me@example.com"], handles: [] },
		at,
	).observation;
}

/** Evaluator that opens an owe-reply on every open unit, citing its newest evidence. */
function opener(title: string) {
	return async (units: readonly FollowupUnit[]) => ({
		units: units.map((unit) => ({
			unitId: unit.unitId,
			open: unit.unitId.startsWith("open:")
				? [
						{
							kind: "owe_reply" as const,
							title,
							counterpart: "Dana",
							confidence: 0.9,
							evidenceIds: [unit.nodeIds.at(-1) as string],
						},
					]
				: [],
			close: [],
		})),
	});
}

async function openOne(at: Date, title = "Reply to Dana about the deck") {
	email(at, "e1");
	const result = await runFollowupsOnce({
		now: at,
		includeIngest: false,
		evaluate: opener(title),
	});
	expect(result.status).toBe("ok");
	expect(result.opened).toBe(1);
	const loop = listFollowupLoops({ status: "open" })[0];
	if (!loop?.todoId) throw new Error("Expected an open follow-up with a todo");
	return loop;
}

function openTodoTitles(): string[] {
	return listTodos({ status: "open", limit: 200 }).todos.map((t) => t.title);
}

describe.skipIf(!isBun)("follow-up review fixes", () => {
	it("does not bring back a follow-up marked Not useful when the thread gets new mail", async () => {
		const firstAt = new Date(Date.now() + 1000);
		const loop = await openOne(firstAt);
		expect(recordFollowupNotUseful(loop.loopId)).toBe(true);

		const laterAt = new Date(firstAt.getTime() + 60_000);
		email(laterAt, "e2");
		const result = await runFollowupsOnce({
			now: laterAt,
			includeIngest: false,
			evaluate: opener("Respond to Dana on the deck"),
		});
		expect(result.status).toBe("ok");
		expect(result.opened).toBe(0);
		expect(listFollowupLoops({ status: "open" })).toHaveLength(0);
		expect(openTodoTitles()).toEqual([]);
	});

	it("reuses the open loop when the model rewords an owe-reply on the same thread", async () => {
		const firstAt = new Date(Date.now() + 1000);
		const loop = await openOne(firstAt);
		const laterAt = new Date(firstAt.getTime() + 60_000);
		email(laterAt, "e2");
		let seenLoopIds: readonly string[] = [];
		const reworded = opener("Chase Dana's deck review");
		const result = await runFollowupsOnce({
			now: laterAt,
			includeIngest: false,
			evaluate: async (units) => {
				seenLoopIds =
					units.find((unit) => unit.unitId.startsWith("open:"))?.loopIds ?? [];
				return reworded(units);
			},
		});
		expect(result.opened).toBe(0);
		expect(seenLoopIds).toContain(loop.loopId);
		expect(listFollowupLoops({ status: "open" })).toHaveLength(1);
		expect(openTodoTitles()).toEqual(["Reply to Dana about the deck"]);
	});

	it("resolves a loop whose todo no longer exists instead of failing every run", async () => {
		const firstAt = new Date(Date.now() + 1000);
		const loop = await openOne(firstAt);
		updateFollowupLoop(loop.loopId, { todoId: "toby-followup-purged" });
		expect(reopenFollowupTodo(loop.loopId)).toBe(false);

		const laterAt = new Date(firstAt.getTime() + 60_000);
		const reply = email(laterAt, "e2", "other-thread");
		const result = await runFollowupsOnce({
			now: laterAt,
			includeIngest: false,
			evaluate: async (units) => ({
				units: units.map((unit) => ({
					unitId: unit.unitId,
					open: [],
					close: unit.loopIds.includes(loop.loopId)
						? [
								{
									loopId: loop.loopId,
									evidenceId: reply.nodeId,
									confidence: 0.95,
									reason: "Dana's thread was handled.",
								},
							]
						: [],
				})),
			}),
		});
		expect(result.status).toBe("ok");
		expect(result.closed).toBe(1);
		expect(getFollowupLoop(loop.loopId)?.status).toBe("resolved");
		expect(recordFollowupNotUseful(loop.loopId)).toBe(true);
	});

	it("joins an in-progress run instead of starting a second one", async () => {
		const at = new Date(Date.now() + 1000);
		email(at, "e1");
		let calls = 0;
		const open = opener("Reply to Dana");
		const evaluate = async (units: readonly FollowupUnit[]) => {
			calls++;
			await new Promise((resolve) => setTimeout(resolve, 20));
			return open(units);
		};
		const [a, b] = await Promise.all([
			runFollowupsOnce({ now: at, includeIngest: false, evaluate }),
			runFollowupsOnce({ now: at, includeIngest: false, evaluate }),
		]);
		expect(a).toBe(b);
		expect(calls).toBe(1);
		expect(listFollowupLoops({ status: "open" })).toHaveLength(1);
	});

	it("stops re-evaluating once nothing the evaluator sees has changed", async () => {
		const at = new Date(Date.now() + 1000);
		await openOne(at);
		const evaluate = opener("Reply to Dana about the deck");
		// The new loop is now attached to its thread: one more look is expected.
		await runFollowupsOnce({ now: at, includeIngest: false, evaluate });
		const third = await runFollowupsOnce({
			now: at,
			includeIngest: false,
			evaluate,
		});
		expect(third.evaluated).toBe(0);
	});

	it("pages changed observations that share one ingest time", () => {
		const at = new Date(Date.now() + 1000);
		for (const id of ["a", "b", "c"]) email(at, id, `thread-${id}`);
		const since = new Date(at.getTime() - 1000).toISOString();
		const first = listIngestedSince(since, 2);
		expect(first).toHaveLength(2);
		const last = first.at(-1);
		if (!last) throw new Error("Expected a page");
		const rest = listIngestedSince(last.ingestedAt, 2, last.id);
		expect(rest).toHaveLength(1);
		expect(new Set([...first, ...rest].map((o) => o.externalId))).toEqual(
			new Set(["a", "b", "c"]),
		);
		expect(buildFollowupUnits({ since, now: at }).length).toBeGreaterThan(0);
	});
});

describe.skipIf(!isBun)("observation ingest review fixes", () => {
	function fakeSource(items: readonly ObservationInput[]): ObservationSource {
		return {
			id: "plugin:fake",
			displayName: "Fake",
			origin: "plugin",
			defaultEnabled: true,
			async collect({ since, limit = 200 }) {
				return {
					observations: items
						.filter((item) => item.occurredAt >= since)
						.slice(0, limit),
				};
			},
		};
	}

	it("drains a truncated source across pages and resumes where it stopped", async () => {
		const now = new Date();
		const start = now.getTime() - 5 * 86_400_000;
		const items: ObservationInput[] = Array.from({ length: 5200 }, (_, n) => ({
			externalId: `m${n}`,
			kind: "chat.message",
			occurredAt: new Date(start + n * 60_000).toISOString(),
			title: `Message ${n}`,
			actors: [],
		}));
		const source = fakeSource(items);
		const first = await ingestSource(source, now);
		expect(first.error).toBeUndefined();
		// Each page restarts at the previous page's newest item (re-read, so
		// unchanged): ten pages cover 500 + 9 × 499 new items.
		expect(first.created).toBe(4991);
		// Out of pages: the cursor parks at the newest item read, not at now.
		expect(getCursor(source.id)?.since).toBe(items[4990]?.occurredAt);

		const second = await ingestSource(source, now);
		expect(second.created).toBe(209);
		expect(findObservation(source.id, "m5199")).not.toBeNull();
		expect(getCursor(source.id)?.since).toBe(
			new Date(now.getTime() - CURSOR_OVERLAP_MS).toISOString(),
		);
	});

	it("ignores read and flag state in the content hash", () => {
		const base: ObservationInput = {
			externalId: "x",
			kind: "email.message",
			occurredAt: new Date().toISOString(),
			title: "Hello",
			actors: [],
			facts: { seen: false, answered: false, flagged: false, bulk: false },
		};
		expect(
			observationContentHash({
				...base,
				facts: { seen: true, answered: true, flagged: true, bulk: false },
			}),
		).toBe(observationContentHash(base));
		expect(
			observationContentHash({ ...base, facts: { ...base.facts, bulk: true } }),
		).not.toBe(observationContentHash(base));
	});

	it("keeps over-budget extractions queued for the next day", async () => {
		writeConfig({
			integrations: {},
			personas: [],
			graph: { maxExtractionsPerDay: 0 },
		});
		const now = new Date(Date.now() + 1000);
		const [id] = writeGraph({
			nodes: [{ type: "observation", key: "budgeted", label: "Budget" }],
			enrich: ["embed", "extract"],
		}).nodeIds;
		await runGraphEnrichment({
			now,
			embed: async () => null,
			extract: async () => ({ entities: [], links: [] }),
		});
		expect(
			dueEnrichment(100, now.toISOString()).some((e) => e.nodeId === id),
		).toBe(false);
		const tomorrow = new Date(now.getTime() + 86_400_000).toISOString();
		expect(
			dueEnrichment(100, tomorrow).find((e) => e.nodeId === id)?.steps,
		).toEqual(["extract"]);
	});

	it("keeps loop links and ingest times through a graph rebuild", async () => {
		const at = new Date(Date.now() + 1000);
		const loop = await openOne(at);
		const aboutEdges = () =>
			edgesTouching([loop.loopId], { edgeTypes: ["about"], fanout: 100 })
				.filter((edge) => edge.src === loop.loopId)
				.map((edge) => edge.dst)
				.sort();
		const before = aboutEdges();
		expect(before.length).toBeGreaterThan(0);
		const ingestedAt = findObservation("plugin:email", "e1")?.ingestedAt;

		rebuildGraph(new Date(at.getTime() + 60_000));
		expect(aboutEdges()).toEqual(before);
		expect(findObservation("plugin:email", "e1")?.ingestedAt).toBe(ingestedAt);
	});
});
