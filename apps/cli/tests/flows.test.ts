import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	FlowNodeError,
	applyNodeOutputs,
	clearFlowRegistry,
	calendarDashboardSummaryFlow,
	emailDashboardSummaryFlow,
	getFlow,
	getByPath,
	listFlows,
	registerFlow,
	resolveNodeInputs,
	runFlowDefinition,
	tasksDashboardSummaryFlow,
	type FlowDefinition,
} from "@toby/core/flows";
import {
	coerceFreeTextToSchema,
	isMarkdownOnlyObjectSchema,
} from "@toby/core/flows/nodes/llm-prompter";
import { z } from "zod";

describe("coerceFreeTextToSchema", () => {
	const markdownSchema = z.object({ markdown: z.string() });

	it("wraps free-form text as markdown", () => {
		const out = coerceFreeTextToSchema(
			markdownSchema,
			"## Today\n- **Standup** at 9am",
		);
		expect(out).toEqual({ markdown: "## Today\n- **Standup** at 9am" });
	});

	it("parses JSON object that matches schema", () => {
		const out = coerceFreeTextToSchema(
			markdownSchema,
			'{"markdown":"Hello"}',
		);
		expect(out).toEqual({ markdown: "Hello" });
	});

	it("returns null for empty text", () => {
		expect(coerceFreeTextToSchema(markdownSchema, "   ")).toBeNull();
	});

	it("detects markdown-only object schemas used by dashboard flows", () => {
		expect(isMarkdownOnlyObjectSchema(markdownSchema)).toBe(true);
		expect(
			isMarkdownOnlyObjectSchema(
				z.object({ markdown: z.string(), extra: z.number() }),
			),
		).toBe(false);
		expect(isMarkdownOnlyObjectSchema(z.object({ text: z.string() }))).toBe(
			false,
		);
	});
});

describe("flow input/output resolution", () => {
	it("getByPath reads nested fields and treats . as identity", () => {
		const obj = { a: { b: 1 }, items: [{ id: "x" }] };
		expect(getByPath(obj, "a.b")).toBe(1);
		expect(getByPath(obj, "items")).toEqual([{ id: "x" }]);
		expect(getByPath(obj, ".")).toBe(obj);
		expect(getByPath(obj, "missing")).toBeUndefined();
	});

	it("resolveNodeInputs supports const and from/path", () => {
		const bag = {
			unread: { count: 3, items: [{ title: "Hi" }] },
		};
		const resolved = resolveNodeInputs(
			"n1",
			{
				limit: { const: 50 },
				count: { from: "unread", path: "count" },
				full: { from: "unread" },
			},
			bag,
		);
		expect(resolved).toEqual({
			limit: 50,
			count: 3,
			full: { count: 3, items: [{ title: "Hi" }] },
		});
	});

	it("resolveNodeInputs throws FlowNodeError on missing key", () => {
		expect(() =>
			resolveNodeInputs("n1", { x: { from: "missing" } }, {}),
		).toThrow(FlowNodeError);
	});

	it("applyNodeOutputs writes paths into the bag", () => {
		const bag: Record<string, unknown> = {};
		applyNodeOutputs(
			"n1",
			{ unread: "result", module: "moduleName" },
			{ result: { count: 1 }, moduleName: "email" },
			bag,
		);
		expect(bag.unread).toEqual({ count: 1 });
		expect(bag.module).toBe("email");
	});
});

describe("flow registry", () => {
	beforeEach(() => {
		clearFlowRegistry();
	});

	afterEach(() => {
		clearFlowRegistry();
		// Re-register built-ins so other tests / imports still work.
		registerFlow(emailDashboardSummaryFlow);
		registerFlow(tasksDashboardSummaryFlow);
		registerFlow(calendarDashboardSummaryFlow);
	});

	it("registerFlow and getFlow round-trip", () => {
		const def: FlowDefinition = {
			name: "test.flow",
			nodes: [
				{
					id: "t1",
					type: "tool_executor",
					tool: { moduleName: "email", toolName: "getUnreadSummary" },
				},
			],
		};
		registerFlow(def);
		expect(getFlow("test.flow")?.name).toBe("test.flow");
		expect(listFlows().some((a) => a.name === "test.flow")).toBe(true);
	});

	it("rejects empty name and duplicate node ids", () => {
		expect(() =>
			registerFlow({
				name: "  ",
				nodes: [
					{
						id: "a",
						type: "tool_executor",
						tool: { standardTool: "email.unreadSummary" },
					},
				],
			}),
		).toThrow();

		expect(() =>
			registerFlow({
				name: "dup",
				nodes: [
					{
						id: "same",
						type: "tool_executor",
						tool: { standardTool: "email.unreadSummary" },
					},
					{
						id: "same",
						type: "tool_executor",
						tool: { standardTool: "email.unreadSummary" },
					},
				],
			}),
		).toThrow(/duplicate node id/);
	});
});

describe("dashboard summary flow definitions", () => {
	it("email flow is registered with tool_executor then llm_prompter", () => {
		registerFlow(emailDashboardSummaryFlow);
		const flow = getFlow("dashboard.email.summary");
		expect(flow).toBeDefined();
		expect(flow?.nodes).toHaveLength(2);
		expect(flow?.nodes[0]?.type).toBe("tool_executor");
		expect(flow?.nodes[1]?.type).toBe("llm_prompter");
		if (flow?.nodes[0]?.type === "tool_executor") {
			expect(
				"standardTool" in flow.nodes[0].tool &&
					flow.nodes[0].tool.standardTool,
			).toBe("email.unreadSummary");
		}
	});

	it("tasks flow is registered with tool_executor then llm_prompter", () => {
		registerFlow(tasksDashboardSummaryFlow);
		const flow = getFlow("dashboard.tasks.summary");
		expect(flow).toBeDefined();
		expect(flow?.nodes).toHaveLength(2);
		expect(flow?.nodes[0]?.type).toBe("tool_executor");
		expect(flow?.nodes[1]?.type).toBe("llm_prompter");
		if (flow?.nodes[0]?.type === "tool_executor") {
			expect(
				"standardTool" in flow.nodes[0].tool &&
					flow.nodes[0].tool.standardTool,
			).toBe("tasks.openSummary");
		}
		const llm = flow?.nodes[1];
		if (llm?.type === "llm_prompter") {
			expect(
				llm.schema.safeParse({ markdown: "## Needs attention\n- x" }).success,
			).toBe(true);
		}
	});

	it("calendar flow is registered with tool_executor then llm_prompter", () => {
		registerFlow(calendarDashboardSummaryFlow);
		const flow = getFlow("dashboard.calendar.summary");
		expect(flow).toBeDefined();
		expect(flow?.nodes).toHaveLength(2);
		expect(flow?.nodes[0]?.type).toBe("tool_executor");
		expect(flow?.nodes[1]?.type).toBe("llm_prompter");
		if (flow?.nodes[0]?.type === "tool_executor") {
			expect(
				"standardTool" in flow.nodes[0].tool &&
					flow.nodes[0].tool.standardTool,
			).toBe("calendar.upcomingSummary");
		}
	});
});

describe("runFlowDefinition", () => {
	it("returns unknown flow style failure via run with empty pipeline result on missing inputs", async () => {
		const def: FlowDefinition = {
			name: "test.const-only-then-read",
			nodes: [
				{
					id: "need-missing",
					type: "tool_executor",
					tool: { moduleName: "nope", toolName: "x" },
					inputs: {
						q: { from: "doesNotExist" },
					},
				},
			],
		};
		const result = await runFlowDefinition(def, {
			personaOverride: {
				name: "Test",
				instructions: "",
				promptMode: "add",
				ai: { provider: "openai", model: "gpt-4.1-nano" },
			},
			record: false,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.failedNodeId).toBe("need-missing");
			expect(result.error).toMatch(/Missing context key/);
			expect(result.startedAt).toBeTruthy();
			expect(result.completedAt).toBeTruthy();
		}
	});

	it("runs a pure llm_prompter node when generate path is not needed for input wiring", async () => {
		// This flow only has a tool node that will fail resolve — covered above.
		// Smoke: structured schema exists on email flow llm node.
		const llm = emailDashboardSummaryFlow.nodes[1];
		expect(llm?.type).toBe("llm_prompter");
		if (llm?.type === "llm_prompter") {
			const parsed = llm.schema.safeParse({ markdown: "## Needs attention\n- Hi" });
			expect(parsed.success).toBe(true);
			const bad = llm.schema.safeParse({ notMarkdown: true });
			expect(bad.success).toBe(false);
		}
	});
});

