import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAutomationAuthoringTools } from "@toby/core/ai/automation-authoring-tools";
import { automationInputs, matchReason } from "@toby/core/automations/matcher";
import {
	claimPendingAutomation,
	deleteAutomation,
	finishAutomationRun,
	getAutomation,
	ingestAutomationBatch,
	listAutomationRuns,
	listAutomations,
	previewAutomation,
	recoverAutomationRuns,
	saveAutomation,
} from "@toby/core/automations/store";
import { executeAutomationWorker } from "@toby/core/automations/supervisor";
import {
	type AutomationEvent,
	automationDraftSchema,
} from "@toby/core/automations/types";
import { saveUserFlowDocument } from "@toby/core/flows/definition-store";
import { validateUserFlowDocument } from "@toby/core/flows/validate-user-flow";
import { closeChatDbForTests, getDb } from "@toby/core/session-store";
import { saveUserTool } from "@toby/core/user-tools/store";
import { handleAutomations } from "@toby/core/web/handlers/automations";

const now = new Date("2026-10-09T14:00:00Z");
let root: string;
let previous: string | undefined;
const draft = () => ({
	name: "Morning",
	enabled: true,
	trigger: { type: "macos.userReturned", minimumIdleSeconds: 1800 },
	conditions: { timezone: "America/New_York", weekdays: [1, 2, 3, 4, 5] },
	action: {
		type: "flow",
		flowId: "flow.test",
		inputs: {},
		eventInputMappings: { duration: "payload.idleSeconds" },
	},
	policy: { cooldownSeconds: 300, oncePerDay: true },
	notifyOnCompletion: false,
});
function event(
	sequence = 1,
	date = now,
	session = randomUUID(),
): AutomationEvent {
	return {
		version: 1,
		id: `${session}:${sequence}`,
		source: "macos",
		type: "macos.userReturned",
		occurredAt: date.toISOString(),
		observationSessionId: session,
		sequence,
		payload: { idleSeconds: 1800 },
	};
}
function ingest(e: AutomationEvent, date = now) {
	ingestAutomationBatch(
		[e],
		{ sessionId: e.observationSessionId, sequence: e.sequence },
		date,
	);
}
beforeEach(() => {
	previous = process.env.TOBY_DIR;
	root = mkdtempSync(join(tmpdir(), "toby-automations-"));
	process.env.TOBY_DIR = root;
	closeChatDbForTests();
	saveUserFlowDocument({
		id: "flow.test",
		name: "Test",
		nodes: [
			{
				id: "summary",
				type: "llm_prompter",
				schema: { kind: "markdown" },
				systemPrompt: "Summarize",
				userPrompt: "{{json bag.automation}}",
				outputs: { summary: "object" },
			},
		],
	});
});
afterEach(() => {
	closeChatDbForTests();
	if (previous === undefined) Reflect.deleteProperty(process.env, "TOBY_DIR");
	else process.env.TOBY_DIR = previous;
	rmSync(root, { recursive: true, force: true });
});

describe("event automations", () => {
	it("routes file batches only to the matching watch revision and serializes queued work", () => {
		const folderDraft = {
			...draft(),
			trigger: {
				type: "macos.fileChanges",
				folder: "/tmp/inbox",
				kinds: ["new", "changed", "deleted"],
			},
			action: {
				...draft().action,
				eventInputMappings: { files: "payload.changes" },
			},
			policy: { cooldownSeconds: 0, oncePerDay: false },
		};
		const a = saveAutomation(folderDraft);
		const b = saveAutomation({ ...folderDraft, name: "Other folder" });
		const current = new Date();
		const session = randomUUID();
		const fileEvent = (n: number) => ({
			...event(n, current, session),
			type: "macos.fileChanges",
			payload: {
				watchId: `${a.id}:${a.revision}`,
				folder: "/tmp/inbox",
				changes: [
					{
						kind: "new",
						path: "/tmp/inbox/one.txt",
						relativePath: "one.txt",
						size: 1,
						modifiedAt: current.toISOString(),
					},
				],
			},
		});
		ingestAutomationBatch(
			[fileEvent(1)],
			{ sessionId: session, sequence: 1 },
			current,
		);
		const first = claimPendingAutomation(current);
		if (!first) throw new Error("Expected first batch");
		ingestAutomationBatch(
			[fileEvent(2)],
			{ sessionId: session, sequence: 2 },
			current,
		);
		expect(listAutomationRuns(b.id)).toHaveLength(0);
		expect(
			listAutomationRuns(a.id).filter((r) => r.status === "pending"),
		).toHaveLength(1);
		expect(claimPendingAutomation(current)).toBeNull();
		finishAutomationRun(first.id, "success", null);
		expect(claimPendingAutomation(current)?.event.sequence).toBe(2);
		const updated = saveAutomation(
			{ ...folderDraft, name: "Updated" },
			a.id,
			a.revision,
		);
		ingestAutomationBatch(
			[fileEvent(3)],
			{ sessionId: session, sequence: 3 },
			current,
		);
		expect(listAutomationRuns(updated.id)).toHaveLength(2);
	});
	it("executes a validated tool flow with file-event inputs", async () => {
		const script = saveUserTool({
			name: "Inspect changes",
			description: "Verify batch context",
			language: "typescript",
			inputNames: ["changes"],
			outputKind: "text",
			source:
				'export default async ({changes}) => { if (changes[0].kind !== "deleted" || changes[0].path !== "/tmp/inbox/deleted.txt") throw new Error("Missing event inputs"); return "Removal recorded"; };',
		});
		const document = validateUserFlowDocument(
			{
				id: "flow.files",
				name: "Files",
				nodes: [
					{
						id: "inspect",
						type: "tool_executor",
						tool: { userToolId: script.id },
						inputs: {
							changes: { from: "automation", path: "event.payload.changes" },
						},
						outputs: { text: "result" },
					},
				],
				result: { from: "text" },
			},
			{ tools: [], connectedModules: [] },
		);
		saveUserFlowDocument(document);
		const a = saveAutomation({
			...draft(),
			trigger: {
				type: "macos.fileChanges",
				folder: "/tmp/inbox",
				kinds: ["deleted"],
			},
			action: { type: "flow", flowId: "flow.files" },
			policy: { cooldownSeconds: 0, oncePerDay: false },
		});
		const current = new Date();
		const e = {
			...event(1, current),
			type: "macos.fileChanges",
			payload: {
				watchId: `${a.id}:${a.revision}`,
				folder: "/tmp/inbox",
				changes: [
					{
						kind: "deleted",
						path: "/tmp/inbox/deleted.txt",
						relativePath: "deleted.txt",
						size: 3,
						modifiedAt: current.toISOString(),
					},
				],
			},
		};
		ingestAutomationBatch(
			[e],
			{ sessionId: e.observationSessionId, sequence: 1 },
			current,
		);
		expect(await executeAutomationWorker(new AbortController().signal)).toBe(
			true,
		);
		expect(listAutomationRuns(a.id)[0].status).toBe("success");
		expect(listAutomationRuns(a.id)[0].output).toBe("Removal recorded");
		expect(() =>
			validateUserFlowDocument(
				{
					...document,
					nodes: [
						{
							...document.nodes[0],
							inputs: {
								changes: { from: "automation", path: "__proto__.key" },
							},
						},
					],
				},
				{ tools: [], connectedModules: [] },
			),
		).toThrow();
	});
	it("validates triggers, timezone, windows and reserved input names", () => {
		expect(() =>
			automationDraftSchema.parse({
				...draft(),
				conditions: { timezone: "invalid" },
			}),
		).toThrow();
		expect(() =>
			automationDraftSchema.parse({
				...draft(),
				trigger: { type: "macos.didWake", minimumIdleSeconds: 30 },
			}),
		).toThrow();
		expect(() =>
			automationDraftSchema.parse({
				...draft(),
				action: { ...draft().action, inputs: { automation: {} } },
			}),
		).toThrow();
		expect(() =>
			saveAutomation({
				...draft(),
				action: { ...draft().action, flowId: "missing" },
			}),
		).toThrow();
		expect(() =>
			saveAutomation({ ...draft(), trigger: { type: "macos.didWake" } }),
		).toThrow("no idleSeconds");
	});
	it("matches exact idle thresholds, weekdays, overnight windows and stale events", () => {
		const a = saveAutomation(draft());
		expect(matchReason(a, event(), now)).toBeNull();
		expect(
			matchReason(a, { ...event(), payload: { idleSeconds: 1799 } }, now),
		).toBe("idle_threshold");
		const saturday = new Date("2026-10-10T14:00:00Z");
		expect(matchReason(a, event(1, saturday), saturday)).toBe("weekday");
		expect(matchReason(a, event(), new Date(now.getTime() + 120001))).toBe(
			"stale_event",
		);
		const overnight = {
			...a,
			conditions: {
				timezone: "America/New_York",
				timeWindow: { start: "22:00", end: "03:00" },
			},
		};
		const night = new Date("2026-10-10T06:00:00Z");
		expect(matchReason(overnight, event(1, night), night)).toBeNull();
		expect(matchReason(overnight, event(), now)).toBe("time_window");
	});
	it("uses local days across DST and midnight", () => {
		const a = saveAutomation({
			...draft(),
			conditions: { timezone: "America/New_York" },
		});
		const before = new Date("2026-11-01T05:30:00Z");
		const after = new Date("2026-11-01T06:30:00Z");
		expect(
			matchReason(a, event(1, after), after, { claimedDay: "2026-11-01" }),
		).toBe("daily_limit");
		expect(
			matchReason(a, event(1, before), before, { claimedDay: "2026-10-31" }),
		).toBeNull();
		const midnight = new Date("2026-11-02T05:00:00Z");
		expect(
			matchReason(a, event(1, midnight), midnight, {
				claimedDay: "2026-11-01",
			}),
		).toBeNull();
	});
	it("deduplicates repeated batches and consumes limits on claim", () => {
		const a = saveAutomation(draft());
		const e = event();
		ingest(e);
		ingest(e);
		expect(listAutomationRuns(a.id)).toHaveLength(1);
		expect(claimPendingAutomation(now)?.status).toBe("running");
		expect(claimPendingAutomation(now)).toBeNull();
		ingest(
			event(2, new Date(now.getTime() + 1000), e.observationSessionId),
			new Date(now.getTime() + 1000),
		);
		expect(
			listAutomationRuns(a.id).find((r) => r.reason === "daily_limit"),
		).toBeDefined();
		recoverAutomationRuns();
		expect(
			listAutomationRuns(a.id).some((r) => r.status === "interrupted"),
		).toBe(true);
		expect(claimPendingAutomation(now)).toBeNull();
	});
	it("prevents overlapping runs and observes disable/delete before dequeue", () => {
		const a = saveAutomation({
			...draft(),
			policy: { cooldownSeconds: 0, oncePerDay: false },
		});
		ingest(event());
		ingest(event(2));
		expect(listAutomationRuns(a.id).some((r) => r.reason === "busy")).toBe(
			true,
		);
		const { id, revision, createdAt, updatedAt, ...body } = a;
		saveAutomation({ ...body, enabled: false }, id, revision);
		expect(claimPendingAutomation(now)).toBeNull();
		expect(listAutomationRuns(id).some((r) => r.reason === "disabled")).toBe(
			true,
		);
		deleteAutomation(id);
		expect(getAutomation(id)).toBeNull();
		expect(listAutomationRuns(id)).toHaveLength(2);
	});
	it("rejects stale edits and keeps immutable historic definitions", () => {
		const a = saveAutomation(draft());
		ingest(event());
		const { id, revision, createdAt, updatedAt, ...body } = a;
		saveAutomation({ ...body, name: "Changed" }, id, revision);
		expect(() => saveAutomation(body, id, revision)).toThrow("reload");
		expect(listAutomationRuns(id)[0].definition.name).toBe("Morning");
	});
	it("rolls back invalid batches without advancing the committed cursor", () => {
		saveAutomation(draft());
		const e = event();
		expect(() =>
			ingestAutomationBatch(
				[e, { ...e, id: "invalid" }],
				{ sessionId: e.observationSessionId, sequence: 1 },
				now,
			),
		).toThrow();
		expect(listAutomationRuns()).toHaveLength(0);
		expect(getDb().query("SELECT * FROM automation_cursor").all()).toHaveLength(
			0,
		);
	});
	it("preview and mapped inputs do not claim or execute", () => {
		const a = saveAutomation(draft());
		const e = event();
		expect(previewAutomation(a, e, now).matches).toBe(true);
		expect(automationInputs(a, e, "test")).toMatchObject({
			duration: 1800,
			automation: { id: a.id, runId: "test" },
		});
		expect(listAutomationRuns()).toHaveLength(0);
	});
	it("validates dry-run authoring without saving or consuming revisions", async () => {
		const actions: string[] = [];
		const tools = createAutomationAuthoringTools({
			dryRun: true,
			appliedActions: actions,
		});
		const options = { toolCallId: "preview", messages: [] };
		const invalid = await tools.createAutomation.execute?.(
			{ ...draft(), action: { ...draft().action, flowId: "missing" } },
			options,
		);
		expect(invalid).toMatchObject({ ok: false });
		const valid = await tools.createAutomation.execute?.(draft(), options);
		expect(valid).toMatchObject({ ok: true, dryRun: true });
		expect(listAutomations()).toHaveLength(0);
		const a = saveAutomation(draft());
		const stale = await tools.updateAutomation.execute?.(
			{ id: a.id, revision: a.revision + 1, definition: draft() },
			options,
		);
		expect(stale).toMatchObject({ ok: false });
		expect(getAutomation(a.id)?.revision).toBe(a.revision);
		expect(actions).toHaveLength(0);
	});
	it("enforces cooldown after completion and bounds pending work", () => {
		const a = saveAutomation({
			...draft(),
			policy: { cooldownSeconds: 300, oncePerDay: false },
		});
		ingest(event());
		const run = claimPendingAutomation(now);
		if (!run) throw new Error("Expected pending claim");
		finishAutomationRun(run.id, "success", null);
		const later = new Date(now.getTime() + 60000);
		ingest(event(2, later), later);
		expect(listAutomationRuns(a.id).some((r) => r.reason === "cooldown")).toBe(
			true,
		);
		deleteAutomation(a.id);
		for (let n = 0; n < 101; n++)
			saveAutomation({ ...draft(), name: `Capacity ${n}` });
		ingest(event(3));
		expect(
			listAutomationRuns(undefined, 500).filter((r) => r.status === "pending"),
		).toHaveLength(100);
		expect(
			listAutomationRuns(undefined, 500).filter((r) => r.reason === "capacity"),
		).toHaveLength(1);
	});
	it("executes a saved flow and links its persisted run", async () => {
		const script = saveUserTool({
			name: "Greeting",
			description: "Local greeting",
			language: "typescript",
			inputNames: [],
			outputKind: "text",
			source: 'export default async () => "Welcome back";',
		});
		saveUserFlowDocument({
			id: "flow.local",
			name: "Greeting",
			nodes: [
				{
					id: "greet",
					type: "tool_executor",
					tool: { userToolId: script.id },
					outputs: { greeting: "result" },
				},
			],
		});
		saveAutomation({
			...draft(),
			action: { ...draft().action, flowId: "flow.local" },
		});
		const current = new Date();
		ingest(event(1, current), current);
		expect(await executeAutomationWorker(new AbortController().signal)).toBe(
			true,
		);
		const run = listAutomationRuns()[0];
		expect(run.status).toBe("success");
		expect(run.flowRunId).toBeTruthy();
		expect(
			getDb().query("SELECT id FROM flow_runs WHERE id=?").get(run.flowRunId),
		).toBeTruthy();
	});
	it("allows disabling an automation after its flow is removed", () => {
		const a = saveAutomation(draft());
		getDb().query("DELETE FROM flows WHERE id=?").run(a.action.flowId);
		expect(
			saveAutomation({ ...draft(), enabled: false }, a.id, a.revision).enabled,
		).toBe(false);
	});
	it("worker records a failure without replaying the flow", async () => {
		const current = new Date();
		saveAutomation(draft());
		ingest(event(1, current), current);
		let calls = 0;
		const execute = async () => {
			calls++;
			throw new Error("partial delivery");
		};
		await executeAutomationWorker(new AbortController().signal, execute);
		await executeAutomationWorker(new AbortController().signal, execute);
		expect(calls).toBe(1);
		expect(listAutomationRuns()[0].status).toBe("error");
	});
	it("CRUD and preview API preserve rules and reject browser writes", async () => {
		const request = (path: string, method = "GET", body?: unknown) =>
			handleAutomations(
				new Request(`http://127.0.0.1${path}`, {
					method,
					body: body === undefined ? undefined : JSON.stringify(body),
				}),
				path,
			);
		const created = await request("/api/automations", "POST", draft());
		expect(created.status).toBe(201);
		const { automation: a } = (await created.json()) as {
			automation: { id: string };
		};
		expect(
			(await request(`/api/automations/${a.id}/test`, "POST", {})).status,
		).toBe(200);
		expect(listAutomationRuns()).toHaveLength(0);
		expect(
			(
				await handleAutomations(
					new Request("http://127.0.0.1/api/automations", {
						headers: { Origin: "https://example.com" },
					}),
					"/api/automations",
				)
			).status,
		).toBe(403);
		expect((await request(`/api/automations/${a.id}`, "DELETE")).status).toBe(
			200,
		);
		expect(listAutomations()).toHaveLength(0);
	});
});
