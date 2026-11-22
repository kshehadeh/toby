import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeConfig } from "@toby/core/config/index";
import { explainTobyFollowup } from "@toby/core/followups/explain";
import {
	followupTodoId,
	reconcileFollowupLoops,
	reopenFollowupTodo,
	runFollowupsOnce,
} from "@toby/core/followups/scheduler";
import {
	claimEvaluationBudget,
	createFollowupLoop,
	getFollowupLoop,
	listFollowupLoops,
	setFollowupMeta,
	updateFollowupLoop,
} from "@toby/core/followups/store";
import {
	buildFollowupUnits,
	changedFollowupUnits,
} from "@toby/core/followups/units";
import { findNode, getNode } from "@toby/core/graph/store";
import { writeGraph } from "@toby/core/graph/write";
import { closeMemoryDbForTests } from "@toby/core/memory/memory-store";
import { ingestObservation } from "@toby/core/observations/ingest";
import { closeChatDbForTests } from "@toby/core/session-store";
import {
	createTodo,
	deleteTodo,
	getTodo,
	listOrganization,
	listTodos,
	transitionTodo,
} from "@toby/core/todos/service";

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
let dir = "";

beforeEach(() => {
	dir = path.join(os.tmpdir(), `toby-followups-test-${randomUUID()}`);
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

function email(now: Date, id = "email-1", threadId = "thread-1") {
	return ingestObservation(
		"plugin:email",
		{
			externalId: id,
			kind: "email.message",
			threadId,
			direction: "inbound",
			occurredAt: now.toISOString(),
			title: "Can you review the deck?",
			excerpt: "CONFIDENTIAL EMAIL BODY",
			url: `https://mail.example/${id}`,
			actors: [
				{ role: "from", email: "dana@example.com", name: "Dana" },
				{ role: "to", email: "me@example.com", name: "Me" },
			],
		},
		{ emails: ["me@example.com"], handles: [] },
		now,
	).observation;
}

describe.skipIf(!isBun)("automatic follow-ups", () => {
	it("checks recent linked activity before expiry without treating old ingestion as new activity", () => {
		const now = new Date();
		const oldAt = new Date(now.getTime() - 31 * 86_400_000);
		const makeLoop = (key: string) => {
			const node = { type: "loop" as const, key, label: key };
			const loopId = writeGraph({ nodes: [node] }).nodeIds[0] as string;
			createFollowupLoop({
				loopId,
				kind: "commitment",
				fingerprint: key,
				title: key,
				confidence: 0.9,
				lastActivityAt: oldAt.toISOString(),
			});
			return { node, loopId };
		};
		const active = makeLoop("recent-activity");
		const inactive = makeLoop("old-activity");
		const recentAt = new Date(now.getTime() - 10 * 86_400_000);
		for (const [loop, occurredAt] of [
			[active, recentAt],
			[inactive, oldAt],
		] as const) {
			const observation = ingestObservation(
				"plugin:email",
				{
					externalId: loop.loopId,
					kind: "email.message",
					occurredAt: occurredAt.toISOString(),
					title: "Activity",
					actors: [],
				},
				{ emails: [], handles: [] },
				now,
			).observation;
			writeGraph({
				edges: [
					{
						src: loop.node,
						dst: { type: "observation", key: `plugin:email:${loop.loopId}` },
						type: "evidence_for",
					},
				],
			});
			expect(observation.ingestedAt).toBe(now.toISOString());
		}
		reconcileFollowupLoops(now);
		expect(getFollowupLoop(active.loopId)).toMatchObject({
			status: "open",
			lastActivityAt: recentAt.toISOString(),
		});
		expect(getFollowupLoop(inactive.loopId)?.status).toBe("expired");
		expect(reconcileFollowupLoops(now)).toBe(0);
	});

	it("prioritizes user completion and deletion over inactivity expiry", () => {
		const now = new Date();
		for (const action of ["complete", "delete"] as const) {
			const todo = createTodo({ title: action }, { source: "followups" });
			const loopId = writeGraph({ nodes: [{ type: "loop", key: action }] })
				.nodeIds[0] as string;
			createFollowupLoop({
				loopId,
				kind: "commitment",
				fingerprint: action,
				title: action,
				todoId: todo.id,
				confidence: 0.9,
				lastActivityAt: new Date(now.getTime() - 31 * 86_400_000).toISOString(),
			});
			if (action === "complete")
				transitionTodo(todo.id, "complete", {}, { source: "app" });
			else deleteTodo(todo.id, false, { source: "app" });
			reconcileFollowupLoops(now);
			expect(getFollowupLoop(loopId)?.status).toBe(
				action === "complete" ? "resolved" : "dismissed",
			);
		}
	});

	it("builds opening candidates from calendar notes but not memories alone", () => {
		const now = new Date();
		for (const source of ["calendar", "memory"]) {
			ingestObservation(
				source,
				{
					externalId: source,
					kind: source === "calendar" ? "calendar.event" : "memory.item",
					occurredAt: now.toISOString(),
					title: "Deliver the deck",
					actors: [],
				},
				{ emails: [], handles: [] },
				now,
			);
		}
		const units = buildFollowupUnits({
			since: new Date(now.getTime() - 1).toISOString(),
			now,
		});
		expect(units.map((unit) => unit.unitId)).toEqual([
			"open:calendar:calendar",
		]);
	});

	it("reconciles a generic reopen of an auto-completed resolved loop", async () => {
		const now = new Date();
		const observation = email(now);
		await runFollowupsOnce({
			now,
			includeIngest: false,
			evaluate: async (batch) => ({
				units: batch.map((unit) => ({
					unitId: unit.unitId,
					close: [],
					open: [
						{
							kind: "owe_reply",
							title: "Reply to Dana",
							confidence: 0.95,
							evidenceIds: [observation.nodeId],
						},
					],
				})),
			}),
		});
		const loop = listFollowupLoops()[0];
		if (!loop?.todoId) throw new Error("Expected follow-up todo");
		transitionTodo(loop.todoId, "complete", {}, { source: "followups" });
		updateFollowupLoop(loop.loopId, { status: "resolved" });
		transitionTodo(loop.todoId, "reopen", {}, { source: "app" });
		const later = new Date(now.getTime() + 31 * 86_400_000);
		expect(reconcileFollowupLoops(later)).toBe(1);
		expect(getFollowupLoop(loop.loopId)).toMatchObject({
			status: "open",
			resolutionRejected: true,
		});
		expect(getNode(loop.loopId)?.props.status).toBe("open");
		expect(reconcileFollowupLoops(new Date())).toBe(0);
	});

	it("builds close candidates through a person, a project, and a related_to edge", () => {
		const base = new Date(Date.now() + 1200);
		const incoming = email(base);
		const makeLoop = (key: string) => {
			const node = {
				type: "loop" as const,
				key,
				label: key,
				props: { kind: "commitment", status: "open" },
			};
			const loopId = writeGraph({ nodes: [node] }).nodeIds[0];
			if (!loopId) throw new Error("Failed to create graph loop");
			createFollowupLoop({
				loopId,
				kind: "commitment",
				fingerprint: key,
				title: key,
				confidence: 0.9,
				lastActivityAt: base.toISOString(),
			});
			return { node, loopId };
		};
		const personLoop = makeLoop("person-loop");
		const projectLoop = makeLoop("project-loop");
		const relatedLoop = makeLoop("related-loop");
		const dana = findNode({ type: "person", key: "email:dana@example.com" });
		if (!dana) throw new Error("Expected Dana person node");
		const project = {
			type: "project" as const,
			key: "name:launch-deck",
			label: "Launch deck",
		};
		writeGraph({
			edges: [
				{
					src: { type: "person", key: dana.key },
					dst: personLoop.node,
					type: "about",
				},
				{
					src: { type: "observation", key: "plugin:email:email-1" },
					dst: project,
					type: "about",
				},
				{ src: project, dst: projectLoop.node, type: "about" },
				{
					src: { type: "observation", key: "plugin:email:email-1" },
					dst: relatedLoop.node,
					type: "about",
				},
			],
		});
		const personEvidence = ingestObservation(
			"toby.chat",
			{
				externalId: "person-evidence",
				kind: "chat.message",
				occurredAt: new Date(base.getTime() + 1).toISOString(),
				title: "I sent Dana the file",
				actors: [
					{ role: "mentioned", email: "dana@example.com", name: "Dana" },
				],
			},
			{ emails: [], handles: [] },
			new Date(base.getTime() + 1),
		).observation;
		const projectEvidence = ingestObservation(
			"toby.chat",
			{
				externalId: "project-evidence",
				kind: "chat.message",
				occurredAt: new Date(base.getTime() + 2).toISOString(),
				title: "The launch deck is done",
				actors: [],
			},
			{ emails: [], handles: [] },
			new Date(base.getTime() + 2),
		).observation;
		const relatedEvidence = ingestObservation(
			"toby.chat",
			{
				externalId: "related-evidence",
				kind: "chat.message",
				occurredAt: new Date(base.getTime() + 3).toISOString(),
				title: "Sent it this morning",
				actors: [],
			},
			{ emails: [], handles: [] },
			new Date(base.getTime() + 3),
		).observation;
		writeGraph({
			edges: [
				{
					src: {
						type: "observation",
						key: `toby.chat:${projectEvidence.externalId}`,
					},
					dst: project,
					type: "about",
				},
				{
					src: {
						type: "observation",
						key: `toby.chat:${relatedEvidence.externalId}`,
					},
					dst: { type: "observation", key: "plugin:email:email-1" },
					type: "related_to",
					origin: "semantic",
					weight: 0.9,
				},
			],
		});
		const units = buildFollowupUnits({
			since: base.toISOString(),
			now: new Date(base.getTime() + 4),
		});
		const loopsByEvidence = new Map(
			units
				.filter((unit) => unit.unitId.startsWith("close:"))
				.map((unit) => [unit.unitId, unit.loopIds]),
		);
		expect(loopsByEvidence.get(`close:${personEvidence.nodeId}`)).toContain(
			personLoop.loopId,
		);
		expect(loopsByEvidence.get(`close:${projectEvidence.nodeId}`)).toContain(
			projectLoop.loopId,
		);
		expect(loopsByEvidence.get(`close:${relatedEvidence.nodeId}`)).toContain(
			relatedLoop.loopId,
		);
	});

	it("creates a stable todo in From Toby with a concise source explanation", async () => {
		const now = new Date(Date.now() + 2000);
		const observation = email(now);
		const evaluate = async (
			units: Parameters<typeof runFollowupsOnce>[0]["evaluate"] extends (
				units: infer U,
			) => Promise<unknown>
				? U
				: never,
		) => ({
			units: units.map((unit) => ({
				unitId: unit.unitId,
				open: [
					{
						kind: "owe_reply" as const,
						title: "Reply to Dana about the deck",
						counterpart: "Dana",
						due: "2027-01-10T12:30:00.000Z",
						confidence: 0.92,
						evidenceIds: [observation.nodeId],
					},
				],
				close: [],
			})),
		});
		const result = await runFollowupsOnce({
			now,
			includeIngest: false,
			evaluate,
		});
		expect(result.status).toBe("ok");
		expect(result.opened).toBe(1);
		const loop = listFollowupLoops({ status: "open" })[0];
		expect(loop).toBeDefined();
		const todoId = followupTodoId(loop?.fingerprint ?? "");
		const todo = getTodo(todoId);
		expect(todo.title).toBe("Reply to Dana about the deck");
		expect(todo.due).toEqual({
			date: "2027-01-10",
			time: "12:30",
			timezone: "UTC",
		});
		expect(
			listOrganization("list").find(
				(item) => "name" in item && item.name === "From Toby",
			)?.id,
		).toBe(todo.listId);
		expect(
			listOrganization("tag").find(
				(item) => "name" in item && item.name === "auto",
			)?.id,
		).toBe(todo.tags[0]);
		expect(todo.description).toContain("https://mail.example/email-1");
		expect(todo.description).not.toContain("CONFIDENTIAL EMAIL BODY");
		expect(explainTobyFollowup(todoId)?.evidence[0]?.reason).toContain(
			"Evidence supporting",
		);

		const repeated = await runFollowupsOnce({
			now,
			includeIngest: false,
			evaluate,
		});
		expect(repeated.opened).toBe(0);
		expect(
			listTodos({ status: "all", limit: 200 }).todos.filter(
				(item) => item.id === todoId,
			),
		).toHaveLength(1);
	});

	it("reuses an active loop when new evidence arrives in the same thread", async () => {
		const firstAt = new Date(Date.now() + 2500);
		const first = email(firstAt, "thread-first", "reused-thread");
		const evaluateFor =
			(evidenceId: string) =>
			async (
				units: Parameters<typeof runFollowupsOnce>[0]["evaluate"] extends (
					units: infer U,
				) => Promise<unknown>
					? U
					: never,
			) => ({
				units: units.map((unit) => ({
					unitId: unit.unitId,
					open: [
						{
							kind: "owe_reply" as const,
							title: "Reply to Dana about the deck",
							confidence: 0.91,
							evidenceIds: [evidenceId],
						},
					],
					close: [],
				})),
			});
		await runFollowupsOnce({
			now: firstAt,
			includeIngest: false,
			evaluate: evaluateFor(first.nodeId),
		});
		const initial = listFollowupLoops({ status: "open" });
		expect(initial).toHaveLength(1);

		const laterAt = new Date(firstAt.getTime() + 60_000);
		const second = email(laterAt, "thread-second", "reused-thread");
		const result = await runFollowupsOnce({
			now: laterAt,
			includeIngest: false,
			evaluate: evaluateFor(second.nodeId),
		});
		expect(result.opened).toBe(0);
		expect(listFollowupLoops({ status: "open" })).toHaveLength(1);
		expect(
			explainTobyFollowup(initial[0]?.todoId ?? "")?.evidence.map(
				(item) => item.id,
			),
		).toContain(second.nodeId);
	});

	it("reschedules unanswered outbound threads when the wait window elapses", () => {
		writeConfig({
			integrations: {},
			personas: [],
			followups: { awaitingReplyDays: 3 },
		});
		const sentAt = new Date(Date.now() + 10_000);
		ingestObservation(
			"plugin:email",
			{
				externalId: "sent-1",
				threadId: "waiting-thread",
				kind: "email.message",
				direction: "outbound",
				occurredAt: sentAt.toISOString(),
				title: "Proposal for review",
				actors: [
					{ role: "from", email: "me@example.com", name: "Me" },
					{ role: "to", email: "dana@example.com", name: "Dana" },
				],
			},
			{ emails: ["me@example.com"], handles: [] },
			sentAt,
		);
		const since = sentAt.toISOString();
		const dayTwo = new Date(sentAt.getTime() + 2 * 86_400_000);
		const beforeWait = buildFollowupUnits({ since, now: dayTwo }).find((unit) =>
			unit.unitId.includes("waiting-thread"),
		);
		const beforeWaitLater = buildFollowupUnits({
			since,
			now: new Date(dayTwo.getTime() + 60_000),
		}).find((unit) => unit.unitId.includes("waiting-thread"));
		const afterWait = buildFollowupUnits({
			since: new Date(sentAt.getTime() + 1).toISOString(),
			now: new Date(sentAt.getTime() + 3 * 86_400_000),
		}).find((unit) => unit.unitId.includes("waiting-thread"));
		expect(beforeWait?.waitingReplyEligible).toBe(false);
		expect(beforeWaitLater?.hash).toBe(beforeWait?.hash);
		expect(afterWait?.waitingReplyEligible).toBe(true);
		expect(afterWait?.hash).not.toBe(beforeWait?.hash);
		writeConfig({
			integrations: {},
			personas: [],
			followups: { awaitingReplyDays: 3, kinds: { oweReply: false } },
		});
		const changedSettings = buildFollowupUnits({
			since: new Date(sentAt.getTime() + 1).toISOString(),
			now: new Date(sentAt.getTime() + 3 * 86_400_000),
		}).find((unit) => unit.unitId.includes("waiting-thread"));
		expect(changedSettings?.hash).not.toBe(afterWait?.hash);
	});

	it("does not reevaluate a waiting thread forever when evidence is unchanged", async () => {
		const sentAt = new Date(Date.now() - 4 * 86_400_000);
		const sent = ingestObservation(
			"plugin:email",
			{
				externalId: "stable-waiting-mail",
				threadId: "stable-waiting-thread",
				kind: "email.message",
				direction: "outbound",
				occurredAt: sentAt.toISOString(),
				title: "Proposal for review",
				actors: [
					{ role: "from", email: "me@example.com", name: "Me" },
					{ role: "to", email: "dana@example.com", name: "Dana" },
				],
			},
			{ emails: ["me@example.com"], handles: [] },
			sentAt,
		).observation;
		const firstAt = new Date();
		writeConfig({
			integrations: {},
			personas: [],
			followups: { awaitingReplyDays: 3 },
		});
		const evaluate = async (
			units: Parameters<typeof runFollowupsOnce>[0]["evaluate"] extends (
				units: infer U,
			) => Promise<unknown>
				? U
				: never,
		) => ({
			units: units.map((unit) => ({
				unitId: unit.unitId,
				open: [
					{
						kind: "awaiting_reply" as const,
						title: "Follow up with Dana",
						confidence: 0.9,
						evidenceIds: [sent.nodeId],
					},
				],
				close: [],
			})),
		});
		const first = await runFollowupsOnce({
			now: firstAt,
			includeIngest: false,
			evaluate,
		});
		expect(first.opened).toBe(1);

		const secondAt = new Date(firstAt.getTime() + 10 * 60_000);
		const second = await runFollowupsOnce({
			now: secondAt,
			includeIngest: false,
			evaluate,
		});
		expect(second.candidates).toBeGreaterThan(0);
		const thirdAt = new Date(secondAt.getTime() + 10 * 60_000);
		const third = await runFollowupsOnce({
			now: thirdAt,
			includeIngest: false,
			evaluate,
		});
		expect(third.candidates).toBe(0);
	});

	it("filters disabled sources from candidates and graph context", () => {
		const now = new Date(Date.now() + 15_000);
		const incoming = email(now, "disabled-source", "disabled-thread");
		writeGraph({
			nodes: [
				{
					type: "memory",
					key: "disabled-memory-context",
					label: "Disabled memory label",
					props: { text: "Disabled memory content" },
				},
			],
			edges: [
				{
					src: { type: "observation", key: "plugin:email:disabled-source" },
					dst: { type: "memory", key: "disabled-memory-context" },
					type: "related_to",
					weight: 1,
				},
			],
		});
		writeConfig({
			integrations: {},
			personas: [],
			followups: { sources: { memory: false } },
		});
		const defaultUnits = buildFollowupUnits({ since: now.toISOString(), now });
		const openUnit = defaultUnits.find((unit) =>
			unit.unitId.startsWith("open:"),
		);
		expect(openUnit?.promptContext).not.toContain("Disabled memory content");
		expect(openUnit?.nodeIds).toContain(incoming.nodeId);

		writeConfig({
			integrations: {},
			personas: [],
			followups: { sources: { "plugin:email": false } },
		});
		expect(buildFollowupUnits({ since: now.toISOString(), now })).toHaveLength(
			0,
		);
	});

	it("returns evaluation budget after a failed evaluator call", async () => {
		const now = new Date();
		email(now);
		writeConfig({
			integrations: {},
			personas: [],
			followups: { maxEvaluationsPerDay: 1 },
		});
		const result = await runFollowupsOnce({
			now,
			includeIngest: false,
			evaluate: async () => {
				throw new Error("mock evaluator failure");
			},
		});
		expect(result.status).toBe("error");
		expect(claimEvaluationBudget(1, 1, now)).toBe(1);

		const malformedAt = new Date(now.getTime() + 86_400_000);
		email(malformedAt, "malformed-evaluator", "malformed-thread");
		writeConfig({
			integrations: {},
			personas: [],
			followups: { maxEvaluationsPerDay: 1 },
		});
		const malformed = await runFollowupsOnce({
			now: malformedAt,
			includeIngest: false,
			evaluate: async () => ({
				units: [{ unitId: "malformed", open: "invalid", close: [] }],
			}),
		});
		expect(malformed.status).toBe("error");
		expect(claimEvaluationBudget(1, 1, malformedAt)).toBe(1);
	});

	it("drops unknown and missing evaluator unit IDs and refunds unjudged units", async () => {
		const now = new Date(Date.now() + 18_000);
		email(now, "partial-one", "partial-thread-one");
		email(new Date(now.getTime() + 1), "partial-two", "partial-thread-two");
		writeConfig({
			integrations: {},
			personas: [],
			followups: { maxEvaluationsPerDay: 2 },
		});
		const result = await runFollowupsOnce({
			now,
			includeIngest: false,
			evaluate: async (units) => ({
				units: [
					{ unitId: units[0]?.unitId ?? "missing", open: [], close: [] },
					{ unitId: "unknown-unit", open: [], close: [] },
				],
			}),
		});
		expect(result.status).toBe("ok");
		expect(result.candidates).toBe(2);
		expect(result.evaluated).toBe(1);
		expect(claimEvaluationBudget(2, 2, now)).toBe(1);
	});

	it("records loop resolution without completing the todo when auto-complete is off", async () => {
		const openedAt = new Date(Date.now() - 2000);
		const original = email(
			openedAt,
			"manual-complete",
			"manual-complete-thread",
		);
		writeConfig({
			integrations: {},
			personas: [],
			followups: { autoComplete: false },
		});
		await runFollowupsOnce({
			now: openedAt,
			includeIngest: false,
			evaluate: async (units) => ({
				units: units.map((unit) => ({
					unitId: unit.unitId,
					open: [
						{
							kind: "owe_reply" as const,
							title: "Reply to Dana",
							confidence: 0.9,
							evidenceIds: [original.nodeId],
						},
					],
					close: [],
				})),
			}),
		});
		const loop = listFollowupLoops({ status: "open" })[0];
		if (!loop?.todoId) throw new Error("Expected follow-up todo");
		const dana = findNode({ type: "person", key: "email:dana@example.com" });
		if (!dana) throw new Error("Expected Dana person node");
		writeGraph({
			edges: [
				{
					src: { type: "person", key: dana.key },
					dst: { type: "loop", key: loop.fingerprint },
					type: "about",
				},
			],
		});

		const evidenceAt = new Date(openedAt.getTime() + 1000);
		const evidence = ingestObservation(
			"toby.chat",
			{
				externalId: "manual-completion-evidence",
				kind: "chat.message",
				occurredAt: evidenceAt.toISOString(),
				title: "I replied to Dana",
				actors: [
					{ role: "mentioned", email: "dana@example.com", name: "Dana" },
				],
			},
			{ emails: [], handles: [] },
			evidenceAt,
		).observation;
		const result = await runFollowupsOnce({
			now: evidenceAt,
			includeIngest: false,
			evaluate: async (units) => ({
				units: units.map((unit) => ({
					unitId: unit.unitId,
					open: [],
					close:
						unit.unitId === `close:${evidence.nodeId}`
							? [
									{
										loopId: loop.loopId,
										confidence: 0.95,
										evidenceId: evidence.nodeId,
										reason: "The reply is complete.",
									},
								]
							: [],
				})),
			}),
		});
		expect(result.closed).toBe(1);
		expect(getFollowupLoop(loop.loopId)?.status).toBe("resolved");
		expect(getTodo(loop.todoId).state.status).toBe("open");
	});

	it("opens a fresh loop when new evidence follows a resolved loop", async () => {
		const firstAt = new Date(Date.now() + 20_000);
		const first = email(firstAt, "first", "same-thread");
		const evaluate =
			(evidenceId: string) =>
			async (
				units: Parameters<typeof runFollowupsOnce>[0]["evaluate"] extends (
					units: infer U,
				) => Promise<unknown>
					? U
					: never,
			) => ({
				units: units.map((unit) => ({
					unitId: unit.unitId,
					open: [
						{
							kind: "commitment" as const,
							title: "Send Dana the revised deck",
							confidence: 0.9,
							evidenceIds: [evidenceId],
						},
					],
					close: [],
				})),
			});
		await runFollowupsOnce({
			now: firstAt,
			includeIngest: false,
			evaluate: evaluate(first.nodeId),
		});
		const oldLoop = listFollowupLoops({ status: "open" })[0];
		if (!oldLoop?.todoId) throw new Error("Expected initial loop");
		transitionTodo(
			oldLoop.todoId,
			"complete",
			{ allowIncompleteChecklist: true },
			{ source: "app" },
		);
		reconcileFollowupLoops(new Date(firstAt.getTime() + 1000));

		const laterAt = new Date(firstAt.getTime() + 2000);
		const newer = email(laterAt, "second", "same-thread");
		const result = await runFollowupsOnce({
			now: laterAt,
			includeIngest: false,
			evaluate: evaluate(newer.nodeId),
		});
		expect(result.opened).toBe(1);
		const loops = listFollowupLoops({ status: "open" });
		expect(loops).toHaveLength(1);
		expect(loops[0]?.loopId).not.toBe(oldLoop.loopId);
	});

	it("closes through a shared person, supports Reopen, and requires new evidence to close again", async () => {
		const firstAt = new Date(Date.now() - 5000);
		const original = email(firstAt);
		const openRun = await runFollowupsOnce({
			now: firstAt,
			includeIngest: false,
			evaluate: async (units) => ({
				units: units.map((unit) => ({
					unitId: unit.unitId,
					open: [
						{
							kind: "owe_reply" as const,
							title: "Reply to Dana",
							counterpart: "Dana",
							confidence: 0.9,
							evidenceIds: [original.nodeId],
						},
					],
					close: [],
				})),
			}),
		});
		expect(openRun.opened).toBe(1);
		const loop = listFollowupLoops({ status: "open" })[0];
		if (!loop?.todoId) throw new Error("Expected follow-up todo");

		const repliedAt = new Date(firstAt.getTime() + 1000);
		const reply = ingestObservation(
			"toby.chat",
			{
				externalId: "chat-1",
				kind: "chat.message",
				occurredAt: repliedAt.toISOString(),
				title: "I sent Dana the deck",
				excerpt: "I sent Dana the deck this morning.",
				url: "toby://chat/session-1",
				actors: [
					{ role: "mentioned", email: "dana@example.com", name: "Dana" },
				],
			},
			{ emails: [], handles: [] },
			repliedAt,
		).observation;
		const units = buildFollowupUnits({
			since: firstAt.toISOString(),
			now: repliedAt,
		});
		const closeUnit = units.find(
			(unit) => unit.unitId === `close:${reply.nodeId}`,
		);
		expect(closeUnit?.loopIds).toContain(loop.loopId);
		const closeRun = await runFollowupsOnce({
			now: repliedAt,
			includeIngest: false,
			evaluate: async (batch) => ({
				units: batch.map((unit) => ({
					unitId: unit.unitId,
					open: [],
					close:
						unit.unitId === `close:${reply.nodeId}`
							? [
									{
										loopId: loop.loopId,
										confidence: 0.95,
										evidenceId: reply.nodeId,
										reason: "Toby chat says the deck was sent.",
									},
								]
							: [],
				})),
			}),
		});
		expect(closeRun.closed).toBe(1);
		expect(getFollowupLoop(loop.loopId)?.status).toBe("resolved");
		expect(getTodo(loop.todoId).state.status).toBe("completed");

		expect(reopenFollowupTodo(loop.loopId)).toBe(true);
		expect(getFollowupLoop(loop.loopId)?.resolutionRejected).toBe(true);
		expect(getTodo(loop.todoId).state.status).toBe("open");

		setFollowupMeta("last_run_at", firstAt.toISOString());
		const repeatAt = new Date(Date.now() + 1000);
		const repeated = await runFollowupsOnce({
			now: repeatAt,
			includeIngest: false,
			evaluate: async (batch) => ({
				units: batch.map((unit) => ({
					unitId: unit.unitId,
					open: [],
					close:
						unit.unitId === `close:${reply.nodeId}`
							? [
									{
										loopId: loop.loopId,
										confidence: 0.99,
										evidenceId: reply.nodeId,
										reason: "Repeated old evidence.",
									},
								]
							: [],
				})),
			}),
		});
		expect(repeated.closed).toBe(0);
		expect(getFollowupLoop(loop.loopId)?.status).toBe("open");

		const lateIngestedAt = new Date(Date.now() + 2000);
		const oldOccurredAt = new Date(firstAt.getTime() + 1500);
		const lateOldEvidence = ingestObservation(
			"toby.chat",
			{
				externalId: "late-old-evidence",
				kind: "chat.message",
				occurredAt: oldOccurredAt.toISOString(),
				title: "The earlier reply was sent",
				actors: [
					{ role: "mentioned", email: "dana@example.com", name: "Dana" },
				],
			},
			{ emails: [], handles: [] },
			lateIngestedAt,
		).observation;
		const lateRun = await runFollowupsOnce({
			now: lateIngestedAt,
			includeIngest: false,
			evaluate: async (batch) => ({
				units: batch.map((unit) => ({
					unitId: unit.unitId,
					open: [],
					close:
						unit.unitId === `close:${lateOldEvidence.nodeId}`
							? [
									{
										loopId: loop.loopId,
										confidence: 0.99,
										evidenceId: lateOldEvidence.nodeId,
										reason: "Late-ingested old evidence.",
									},
								]
							: [],
				})),
			}),
		});
		expect(lateRun.closed).toBe(0);
		expect(getFollowupLoop(loop.loopId)?.status).toBe("open");

		const newerAt = new Date(Date.now() + 3000);
		const newer = ingestObservation(
			"toby.chat",
			{
				externalId: "chat-2",
				kind: "chat.message",
				occurredAt: newerAt.toISOString(),
				title: "The deck is in the shared folder",
				actors: [
					{ role: "mentioned", email: "dana@example.com", name: "Dana" },
				],
			},
			{ emails: [], handles: [] },
			newerAt,
		).observation;
		const afterReopen = await runFollowupsOnce({
			now: newerAt,
			includeIngest: false,
			evaluate: async (batch) => ({
				units: batch.map((unit) => ({
					unitId: unit.unitId,
					open: [],
					close:
						unit.unitId === `close:${newer.nodeId}`
							? [
									{
										loopId: loop.loopId,
										confidence: 0.99,
										evidenceId: newer.nodeId,
										reason: "New chat evidence.",
									},
								]
							: [],
				})),
			}),
		});
		expect(afterReopen.closed).toBe(1);
		expect(getFollowupLoop(loop.loopId)?.status).toBe("resolved");
		expect(getTodo(loop.todoId).state.status).toBe("completed");
	});

	it("reconciles user completion and deleted todos; unchanged units are filtered without mutation", async () => {
		const now = new Date(Date.now() + 8000);
		const observation = email(now);
		const run = await runFollowupsOnce({
			now,
			includeIngest: false,
			evaluate: async (units) => ({
				units: units.map((unit) => ({
					unitId: unit.unitId,
					open: [
						{
							kind: "commitment" as const,
							title: "Send the draft",
							confidence: 0.9,
							evidenceIds: [observation.nodeId],
						},
					],
					close: [],
				})),
			}),
		});
		expect(run.opened).toBe(1);
		const loops = listFollowupLoops({ status: "open" });
		const first = loops[0];
		if (!first?.todoId) throw new Error("Expected loop todo");
		transitionTodo(
			first.todoId,
			"complete",
			{ allowIncompleteChecklist: true },
			{ source: "app" },
		);
		expect(reconcileFollowupLoops(new Date(now.getTime() + 1000))).toBe(1);
		expect(getFollowupLoop(first.loopId)?.status).toBe("resolved");

		const later = new Date(now.getTime() + 3000);
		const secondObservation = email(later, "email-2", "thread-2");
		await runFollowupsOnce({
			now: later,
			includeIngest: false,
			evaluate: async (units) => ({
				units: units.map((candidate) => ({
					unitId: candidate.unitId,
					open: candidate.nodeIds.includes(secondObservation.nodeId)
						? [
								{
									kind: "commitment" as const,
									title: "Ask Lee about the draft",
									confidence: 0.9,
									evidenceIds: [secondObservation.nodeId],
								},
							]
						: [],
					close: [],
				})),
			}),
		});
		const second = listFollowupLoops({ status: "open" }).find(
			(candidate) => candidate.title === "Ask Lee about the draft",
		);
		if (!second?.todoId) throw new Error("Expected second todo");
		deleteTodo(second.todoId, false, { source: "app" });
		expect(reconcileFollowupLoops(new Date(later.getTime() + 1000))).toBe(1);
		expect(getFollowupLoop(second.loopId)?.status).toBe("dismissed");

		const unit = buildFollowupUnits({
			since: now.toISOString(),
			now: new Date(now.getTime() + 2000),
		})[0];
		if (unit) {
			expect(changedFollowupUnits([unit], () => unit.hash)).toHaveLength(0);
			expect(listFollowupLoops({ status: "resolved" })).toHaveLength(1);
		}
		const node = getNode(first.loopId);
		expect(node?.props.status).toBe("resolved");
	});
});
