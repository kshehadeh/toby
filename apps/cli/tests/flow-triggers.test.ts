import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	deleteUserFlowDocument,
	saveUserFlowDocument,
} from "@toby/core/flows/definition-store";
import type { FlowDocument } from "@toby/core/flows/document-types";
import { getFlowRun } from "@toby/core/flows/store";
import {
	claimTriggerDecision,
	enqueueScheduledFlows,
	enqueueTrigger,
	finishTriggerDecision,
	ingestNativeEvents,
	listTriggerBindings,
	listTriggerDecisions,
	recoverTriggerDecisions,
	triggerInputs,
} from "@toby/core/flows/triggers/store";
import { executeFlowTriggerWorker } from "@toby/core/flows/triggers/supervisor";
import {
	type FlowTrigger,
	manualTrigger,
	parseFlowTriggers,
} from "@toby/core/flows/triggers/types";
import { closeChatDbForTests, getDb } from "@toby/core/session-store";
import { saveUserTool } from "@toby/core/user-tools/store";
import { handleWebRequest } from "@toby/core/web/routes";
let root: string;
let previous: string | undefined;
const now = new Date("2026-10-12T13:01:00Z");
function trigger(
	source: FlowTrigger["source"] = {
		type: "schedule",
		cron: "0 9 * * 1-5",
		missedRuns: "latest",
	},
): FlowTrigger {
	return {
		...manualTrigger(),
		id: "start",
		name: "Start",
		source,
		conditions: { timezone: "America/New_York" },
	};
}
function flow(triggers = [trigger()], id = "flow.test"): FlowDocument {
	return {
		id,
		name: "Test",
		triggers,
		nodes: [{ id: "ask", type: "agent_task", userPrompt: "Say hello" }],
	};
}
function required<T>(value: T | null | undefined): T {
	if (value == null) throw new Error("Expected value");
	return value;
}
function save(document = flow()) {
	saveUserFlowDocument(document);
	getDb()
		.query("UPDATE flows SET created_at=$created WHERE id=$id")
		.run({ $id: document.id, $created: "2026-10-10T00:00:00Z" });
	return required(listTriggerBindings().find((b) => b.flowId === document.id));
}
beforeEach(() => {
	previous = process.env.TOBY_DIR;
	root = fs.mkdtempSync(path.join(os.tmpdir(), "toby-flow-triggers-"));
	process.env.TOBY_DIR = root;
	closeChatDbForTests();
});
afterEach(() => {
	closeChatDbForTests();
	if (previous === undefined) Reflect.deleteProperty(process.env, "TOBY_DIR");
	else process.env.TOBY_DIR = previous;
	fs.rmSync(root, { recursive: true, force: true });
});
const occurrence = (id = "tick") => ({
	id,
	type: "schedule",
	occurredAt: now.toISOString(),
	payload: {},
});
describe("Flow trigger dispatch", () => {
	it("defaults to manual and rejects duplicate ids, invalid cron, timezone, and reserved input", () => {
		expect(parseFlowTriggers(undefined)[0].source.type).toBe("manual");
		expect(() => parseFlowTriggers([trigger(), trigger()])).toThrow();
		expect(() =>
			parseFlowTriggers([
				{ ...trigger(), source: { type: "schedule", cron: "bad" } },
			]),
		).toThrow();
		expect(() =>
			parseFlowTriggers([
				{ ...trigger(), conditions: { timezone: "Nowhere" } },
			]),
		).toThrow();
		expect(() =>
			parseFlowTriggers([{ ...trigger(), inputs: { trigger: {} } }]),
		).toThrow();
	});
	it("claims each cron occurrence once across repeated polling and restart", () => {
		save();
		enqueueScheduledFlows(now);
		enqueueScheduledFlows(now);
		expect(listTriggerDecisions()).toHaveLength(1);
		expect(claimTriggerDecision(now)?.status).toBe("running");
		recoverTriggerDecisions();
		enqueueScheduledFlows(now);
		expect(listTriggerDecisions()).toHaveLength(1);
		expect(listTriggerDecisions()[0].status).toBe("interrupted");
	});
	it("uses the configured timezone, catches up latest only, and skips old occurrences when requested", () => {
		save();
		enqueueScheduledFlows(new Date("2026-10-12T12:59:00Z"));
		expect(listTriggerDecisions()).toHaveLength(0);
		enqueueScheduledFlows(new Date("2026-10-12T17:00:00Z"));
		expect(listTriggerDecisions()[0].event.occurredAt).toBe(
			"2026-10-12T13:00:00.000Z",
		);
		save(
			flow(
				[
					trigger({
						type: "schedule",
						cron: "0 9 * * 1-5",
						missedRuns: "skip",
					}),
				],
				"flow.skip",
			),
		);
		enqueueScheduledFlows(new Date("2026-10-12T17:00:00Z"));
		expect(listTriggerDecisions("flow.skip")).toHaveLength(0);
	});
	it("keeps a claimed definition snapshot when the flow is edited", () => {
		const binding = save();
		enqueueTrigger(binding, occurrence(), now);
		save({
			...flow(),
			name: "Edited",
			nodes: [{ id: "ask", type: "agent_task", userPrompt: "Changed" }],
		});
		const run = required(claimTriggerDecision(now));
		expect(run.binding.document.name).toBe("Test");
		expect(run.binding.document.nodes[0]).toMatchObject({
			userPrompt: "Say hello",
		});
	});
	it("prevents disabled and deleted triggers starting queued work", () => {
		const binding = save();
		enqueueTrigger(binding, occurrence(), now);
		save(flow([{ ...trigger(), enabled: false }]));
		expect(claimTriggerDecision(now)).toBeNull();
		expect(listTriggerDecisions()[0].reason).toBe("disabled");
		save();
		enqueueTrigger(listTriggerBindings()[0], occurrence("tick2"), now);
		deleteUserFlowDocument("flow.test");
		expect(claimTriggerDecision(now)).toBeNull();
		expect(
			listTriggerDecisions().find((d) => d.event.id === "tick2")?.reason,
		).toBe("deleted");
	});
	it("serializes different triggers of the same flow while allowing two flows globally", () => {
		const bindings = [
			save(),
			save(flow([trigger()], "flow.other")),
			save(flow([trigger()], "flow.third")),
		];
		for (const binding of bindings) enqueueTrigger(binding, occurrence(), now);
		const first = required(claimTriggerDecision(now));
		expect(claimTriggerDecision(now)).not.toBeNull();
		expect(claimTriggerDecision(now)).toBeNull();
		finishTriggerDecision(first.id, "success", null);
		expect(claimTriggerDecision(now)).not.toBeNull();
	});
	it("consumes cooldown on claim even when execution fails; manual ignores automatic limits", () => {
		const t = {
			...trigger(),
			policy: { cooldownSeconds: 300, oncePerDay: true },
		};
		const binding = save(flow([t]));
		enqueueTrigger(binding, occurrence(), now);
		const run = required(claimTriggerDecision(now));
		finishTriggerDecision(run.id, "error", "failed");
		enqueueTrigger(binding, occurrence("tick2"), now);
		expect(
			listTriggerDecisions().find((d) => d.event.id === "tick2")?.reason,
		).toBe("daily_limit");
		const manual = save(
			flow([{ ...t, source: { type: "manual" } }], "flow.manual"),
		);
		enqueueTrigger(manual, { ...occurrence(), type: "manual" }, now);
		expect(claimTriggerDecision(now)?.binding.flowId).toBe("flow.manual");
	});
	it("deduplicates native events, maps their inputs, and rejects stale work", () => {
		const binding = save(
			flow([
				{
					...trigger({ type: "macos.userReturned", minimumIdleSeconds: 1800 }),
					eventInputMappings: { seconds: "payload.idleSeconds" },
				},
			]),
		);
		const session = randomUUID();
		const event = {
			version: 1,
			id: `${session}:1`,
			source: "macos",
			type: "macos.userReturned",
			occurredAt: now.toISOString(),
			observationSessionId: session,
			sequence: 1,
			payload: { idleSeconds: 1900 },
		};
		ingestNativeEvents(
			[event, event],
			{ sessionId: session, sequence: 1 },
			now,
		);
		expect(listTriggerDecisions()).toHaveLength(1);
		expect(triggerInputs(binding, event, "run")).toMatchObject({
			seconds: 1900,
			trigger: { event },
		});
		expect(claimTriggerDecision(new Date(now.getTime() + 121000))).toBeNull();
		expect(listTriggerDecisions()[0].reason).toBe("stale_event");
	});
	it("rejects manual execution without an enabled manual trigger", async () => {
		save();
		const response = await handleWebRequest(
			new Request("http://localhost/api/flows/flow.test/run", {
				method: "POST",
				body: "{}",
			}),
		);
		expect(response?.status).toBe(400);
	});
	it("manual dispatch executes script steps and links the shared run trace", async () => {
		const tool = saveUserTool({
			name: "Echo",
			description: "",
			language: "typescript",
			inputNames: ["source"],
			outputKind: "json",
			source: "export default input => input",
		});
		save({
			...flow([manualTrigger()]),
			nodes: [
				{
					id: "echo",
					type: "tool_executor",
					tool: { userToolId: tool.id },
					inputs: { source: { from: "trigger", path: "event.type" } },
					outputs: { answer: "result" },
				},
			],
			result: { from: "answer", path: "source" },
		});
		const response = await handleWebRequest(
			new Request("http://localhost/api/flows/flow.test/run", {
				method: "POST",
				body: "{}",
			}),
		);
		const body = (await required(response).json()) as {
			ok: boolean;
			runId: string;
		};
		expect(body.ok).toBe(true);
		const decision = listTriggerDecisions()[0];
		expect(decision.status).toBe("success");
		expect(decision.flowRunId).toBe(body.runId);
		expect(getFlowRun(body.runId)).not.toBeNull();
	});
	it("pre-execution failures remain errors rather than being reported as busy", async () => {
		const binding = save(flow([manualTrigger()]));
		// Simulate a malformed captured definition to exercise failure before a run exists.
		binding.document = { ...binding.document, nodes: [] };
		const id = required(
			enqueueTrigger(binding, { ...occurrence(), type: "manual" }),
		);
		const result = await executeFlowTriggerWorker(
			new AbortController().signal,
			id,
		);
		expect(result?.ok).toBe(false);
		expect(listTriggerDecisions()[0].status).toBe("error");
	});
	it("serializes two distinct triggers belonging to one flow", () => {
		save(flow([trigger(), { ...trigger(), id: "other" }]));
		for (const binding of listTriggerBindings())
			enqueueTrigger(binding, occurrence(), now);
		const first = required(claimTriggerDecision(now));
		expect(claimTriggerDecision(now)).toBeNull();
		finishTriggerDecision(first.id, "success", null);
		expect(claimTriggerDecision(now)).not.toBeNull();
	});
	it("rejects stale revisions instead of overwriting newer triggers", () => {
		const original = save();
		save({ ...original.document, triggers: [manualTrigger()] });
		expect(() => save(original.document)).toThrow("Flow changed");
		expect(listTriggerBindings()[0].trigger.source.type).toBe("manual");
	});
	it("runs each file separately, deduplicates replays, and preserves native identity", () => {
		const binding = save(
			flow([
				trigger({
					type: "macos.fileChanges",
					folder: "/tmp/inbox",
					recursive: false,
					extensions: [],
					excludedPaths: [],
					kinds: ["new"],
					settlingSeconds: 5,
					allowLargeFolder: false,
					runPerFile: true,
				}),
			]),
		);
		const session = randomUUID();
		const event = {
			version: 1,
			id: `${session}:1`,
			source: "macos",
			type: "macos.fileChanges",
			occurredAt: now.toISOString(),
			observationSessionId: session,
			sequence: 1,
			payload: {
				watchId: `${binding.id}:${binding.revision}`,
				folder: "/tmp/inbox",
				changes: ["a.png", "b.heic"].map((name) => ({
					kind: "new",
					path: `/tmp/inbox/${name}`,
					relativePath: name,
					size: 10,
					modifiedAt: now.toISOString(),
				})),
			},
		};
		ingestNativeEvents(
			[event, event],
			{ sessionId: session, sequence: 1 },
			now,
		);
		const decisions = listTriggerDecisions();
		expect(decisions).toHaveLength(2);
		expect(decisions.every((d) => d.event.id === event.id)).toBe(true);
		expect(
			decisions.map(
				(d) => (d.event.payload.changes as { path: string }[]).length,
			),
		).toEqual([1, 1]);
		expect(
			decisions
				.map((d) => (d.event.payload.changes as { path: string }[])[0].path)
				.sort(),
		).toEqual(["/tmp/inbox/a.png", "/tmp/inbox/b.heic"]);
		const first = required(claimTriggerDecision(now));
		expect(claimTriggerDecision(now)).toBeNull();
		finishTriggerDecision(first.id, "success", null);
		expect(claimTriggerDecision(now)).not.toBeNull();
	});
	it("queues file batches and ignores events from a replaced watch revision", () => {
		const binding = save(
			flow([
				trigger({
					type: "macos.fileChanges",
					folder: "/tmp/inbox",
					recursive: false,
					extensions: [],
					excludedPaths: [],
					kinds: ["new"],
					settlingSeconds: 5,
					allowLargeFolder: false,
				}),
			]),
		);
		const session = randomUUID();
		const event = (sequence: number, revision = binding.revision) => ({
			version: 1,
			id: `${session}:${sequence}`,
			source: "macos",
			type: "macos.fileChanges",
			occurredAt: now.toISOString(),
			observationSessionId: session,
			sequence,
			payload: {
				watchId: `${binding.id}:${revision}`,
				folder: "/tmp/inbox",
				changes: [
					{
						kind: "new",
						path: "/tmp/inbox/test.txt",
						relativePath: "test.txt",
						size: 10,
						modifiedAt: now.toISOString(),
					},
				],
			},
		});
		ingestNativeEvents(
			[event(1), event(2), event(3, 0)],
			{ sessionId: session, sequence: 3 },
			now,
		);
		expect(listTriggerDecisions()).toHaveLength(2);
		const first = required(claimTriggerDecision(now));
		expect(claimTriggerDecision(now)).toBeNull();
		finishTriggerDecision(first.id, "success", null);
		expect(claimTriggerDecision(now)).not.toBeNull();
	});
});
