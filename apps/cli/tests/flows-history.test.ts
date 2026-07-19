import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	getFlowRun,
	listFlowRuns,
	pruneFlowRuns,
	runFlowDefinition,
	type FlowDefinition,
} from "@toby/core/flows";
import { closeChatDbForTests } from "@toby/core/session-store";

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "toby-flow-hist-"));
}

describe("flow execution history", () => {
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		closeChatDbForTests();
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = makeTempDir();
	});

	afterEach(() => {
		closeChatDbForTests();
		const dir = process.env.TOBY_DIR;
		if (previousTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		if (dir && fs.existsSync(dir)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	const persona = {
		name: "HistoryTest",
		instructions: "",
		promptMode: "add" as const,
		ai: { provider: "openai" as const, model: "gpt-4.1-nano" },
	};

	it("records run + node rows with timestamps when a node fails", async () => {
		const def: FlowDefinition = {
			name: "test.history.fail-tool",
			description: "tool that does not exist",
			nodes: [
				{
					id: "fetch",
					type: "tool_executor",
					tool: { moduleName: "no-such-plugin", toolName: "nope" },
					inputs: { limit: { const: 5 } },
					outputs: { data: "result" },
				},
			],
		};
		const result = await runFlowDefinition(def, {
			personaOverride: persona,
			trigger: "test",
			inputs: { seed: true },
		});

		expect(result.ok).toBe(false);
		expect(result.runId).toBeDefined();
		expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(result.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(result.provider).toBe("openai");
		expect(result.model).toBe("gpt-4.1-nano");

		const run = getFlowRun(result.runId as string);
		expect(run).not.toBeNull();
		if (!run) return;

		expect(run.flowName).toBe("test.history.fail-tool");
		expect(run.status).toBe("error");
		expect(run.trigger).toBe("test");
		expect(run.personaName).toBe("HistoryTest");
		expect(run.provider).toBe("openai");
		expect(run.model).toBe("gpt-4.1-nano");
		expect(run.startedAt).toBeTruthy();
		expect(run.completedAt).toBeTruthy();
		expect(run.durationMs).not.toBeNull();
		expect(run.failedNodeId).toBe("fetch");
		expect(run.definitionSnapshot.nodes).toHaveLength(1);
		expect(run.nodes).toHaveLength(1);

		const node = run.nodes[0];
		expect(node?.nodeId).toBe("fetch");
		expect(node?.status).toBe("error");
		expect(node?.inputs).toEqual({ limit: 5 });
		expect(node?.startedAt).toBeTruthy();
		expect(node?.completedAt).toBeTruthy();
		expect(node?.durationMs).not.toBeNull();
		expect(node?.detail).toBeTruthy();
		const detail = node?.detail as {
			kind?: string;
			toolCalls?: Array<{ ok?: boolean; input?: unknown }>;
		};
		expect(detail.kind).toBe("tool_executor");
		expect(detail.toolCalls?.[0]?.ok).toBe(false);
		expect(detail.toolCalls?.[0]?.input).toEqual({ limit: 5 });
	});

	it("skips DB writes when record is false", async () => {
		const def: FlowDefinition = {
			name: "test.history.no-record",
			nodes: [
				{
					id: "fetch",
					type: "tool_executor",
					tool: { moduleName: "nope", toolName: "x" },
				},
			],
		};

		const result = await runFlowDefinition(def, {
			personaOverride: persona,
			record: false,
		});
		expect(result.ok).toBe(false);
		expect(result.runId).toBeUndefined();
		expect(listFlowRuns().length).toBe(0);
	});

	it("listFlowRuns returns summaries without requiring full node payloads", async () => {
		const def: FlowDefinition = {
			name: "test.history.list",
			nodes: [
				{
					id: "a",
					type: "tool_executor",
					tool: { moduleName: "missing", toolName: "t" },
				},
			],
		};
		const result = await runFlowDefinition(def, {
			personaOverride: persona,
			trigger: "list-test",
		});
		expect(result.runId).toBeDefined();

		const runs = listFlowRuns({ flowName: "test.history.list", limit: 10 });
		expect(runs.length).toBe(1);
		expect(runs[0]?.id).toBe(result.runId);
		expect(runs[0]?.startedAt).toBeTruthy();
		expect(runs[0]?.status).toBe("error");
	});

	it("pruneFlowRuns deletes old completed runs by started_at", async () => {
		const def: FlowDefinition = {
			name: "test.history.prune",
			nodes: [
				{
					id: "a",
					type: "tool_executor",
					tool: { moduleName: "missing", toolName: "t" },
				},
			],
		};
		const result = await runFlowDefinition(def, {
			personaOverride: persona,
		});
		expect(result.runId).toBeDefined();

		// Cutoff in the past: run is not older than that → nothing deleted.
		expect(
			pruneFlowRuns({ olderThanIso: "2000-01-01T00:00:00.000Z" }),
		).toBe(0);
		expect(getFlowRun(result.runId as string)).not.toBeNull();

		// Cutoff in the future: run started_at is older than that → deleted.
		// (Purge API: delete completed rows where started_at < olderThanIso.)
		const deleted = pruneFlowRuns({
			olderThanIso: "2099-12-31T23:59:59.000Z",
		});
		expect(deleted).toBeGreaterThanOrEqual(1);
		expect(getFlowRun(result.runId as string)).toBeNull();
	});
});
