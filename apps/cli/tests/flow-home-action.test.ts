import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listFlowDashboardBlocks } from "@toby/core/dashboard/flow-blocks";
import { saveUserFlowDocument } from "@toby/core/flows/definition-store";
import type { FlowDocument } from "@toby/core/flows/document-types";
import { normalizeHomeActionFlow } from "@toby/core/flows/home-action";
import { listTriggerDecisions } from "@toby/core/flows/triggers/store";
import {
	dashboardRefreshTrigger,
	homeActionTrigger,
	manualTrigger,
} from "@toby/core/flows/triggers/types";
import { closeChatDbForTests } from "@toby/core/session-store";
import { saveUserTool } from "@toby/core/user-tools/store";
import { handleWebRequest } from "@toby/core/web/routes";

let dir: string;
let previous: string | undefined;
beforeEach(() => {
	previous = process.env.TOBY_DIR;
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-home-action-"));
	process.env.TOBY_DIR = dir;
	closeChatDbForTests();
});
afterEach(() => {
	closeChatDbForTests();
	if (previous === undefined) Reflect.deleteProperty(process.env, "TOBY_DIR");
	else process.env.TOBY_DIR = previous;
	fs.rmSync(dir, { recursive: true, force: true });
});
it("Home refresh requires a content card and preserves its update preference", () => {
	const normalized = normalizeHomeActionFlow({
		id: "flow.refresh",
		name: "Refresh",
		nodes: [],
		triggers: [{ ...dashboardRefreshTrigger(), enabled: false }],
		destinations: [
			{
				type: "dashboard",
				variant: "runner",
				color: "teal",
				refresh: "manual",
			},
		],
	});
	expect(normalized.destinations).toEqual([
		{
			type: "dashboard",
			variant: "informational",
			color: "teal",
			refresh: "manual",
		},
	]);
	expect(normalized.triggers?.[0]?.enabled).toBe(false);
	expect(() =>
		normalizeHomeActionFlow({
			...normalized,
			triggers: [dashboardRefreshTrigger(), homeActionTrigger()],
		}),
	).toThrow("Choose either");
});
const document = (): FlowDocument => ({
	id: "flow.home-action",
	name: "Home action",
	triggers: [homeActionTrigger()],
	nodes: [{ id: "ask", type: "agent_task", userPrompt: "Say hello" }],
});
function runnableDocument(): FlowDocument {
	const tool = saveUserTool({
		name: "Echo source",
		description: "",
		language: "typescript",
		inputNames: ["source"],
		outputKind: "json",
		source: "export default input => input",
	});
	return {
		...document(),
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
	};
}
async function run(source?: string) {
	const response = await handleWebRequest(
		new Request("http://localhost/api/flows/flow.home-action/run", {
			method: "POST",
			body: JSON.stringify(source ? { source } : {}),
		}),
	);
	if (!response) throw new Error("Missing response");
	return response;
}

describe("Home Screen Action triggers", () => {
	it("forces one Home Actions placement while preserving other destinations and Home color", () => {
		const normalized = normalizeHomeActionFlow({
			...document(),
			destinations: [
				{ type: "modal" },
				{
					type: "dashboard",
					variant: "informational",
					refresh: "asNeeded",
					color: "teal",
				},
			],
		});
		expect(normalized.destinations).toEqual([
			{ type: "modal" },
			{ type: "dashboard", variant: "runner", color: "teal" },
		]);
		expect(normalizeHomeActionFlow(document()).destinations).toEqual([
			{ type: "dashboard", variant: "runner" },
		]);
		expect(normalizeHomeActionFlow(normalized)).toEqual(normalized);
	});
	it("selecting an Actions placement adds a matching trigger with a unique id", () => {
		const normalized = normalizeHomeActionFlow({
			...document(),
			triggers: [{ ...manualTrigger(), id: "home-action" }],
			destinations: [{ type: "dashboard", variant: "runner" }],
		});
		expect(normalized.triggers).toHaveLength(2);
		expect(normalized.triggers?.[1]).toMatchObject({
			id: "home-action-2",
			enabled: true,
			source: { type: "home.action" },
		});
	});
	it("persists the required placement and hides the button when its trigger is disabled", () => {
		const saved = saveUserFlowDocument(document());
		expect(saved.document.destinations).toEqual([
			{ type: "dashboard", variant: "runner" },
		]);
		expect(listFlowDashboardBlocks().map((b) => b.flowId)).toContain(saved.id);
		saveUserFlowDocument({
			...saved.document,
			triggers: [{ ...homeActionTrigger(), enabled: false }],
		});
		expect(listFlowDashboardBlocks()).toHaveLength(0);
	});
	it("Home-only flows run from Home through shared history, and reject generic Run Now", async () => {
		saveUserFlowDocument(runnableDocument());
		expect((await run()).status).toBe(400);
		const response = await run("home.action");
		expect(response.status).toBe(200);
		const result = (await response.json()) as {
			ok: boolean;
			result: { text: string };
			runId: string;
		};
		expect(result.ok).toBe(true);
		expect(result.result.text).toBe("home.action");
		expect(listTriggerDecisions()[0]).toMatchObject({
			status: "success",
			flowRunId: result.runId,
			event: { type: "home.action" },
		});
	});
	it("selects the matching entry point when a flow has both manual and Home triggers", async () => {
		saveUserFlowDocument({
			...runnableDocument(),
			triggers: [manualTrigger(), homeActionTrigger()],
		});
		expect((await (await run("home.action")).json()).result.text).toBe(
			"home.action",
		);
		expect((await (await run()).json()).result.text).toBe("manual");
		expect((await run("schedule")).status).toBe(400);
		const saved = saveUserFlowDocument({
			...runnableDocument(),
			triggers: [{ ...homeActionTrigger(), enabled: false }],
		});
		expect((await run("home.action")).status).toBe(400);
		expect(listTriggerDecisions(saved.id)).toHaveLength(2);
	});
});
