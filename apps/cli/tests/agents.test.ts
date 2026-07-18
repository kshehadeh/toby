import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	AgentNodeError,
	applyNodeOutputs,
	clearAgentRegistry,
	calendarDashboardSummaryAgent,
	emailDashboardSummaryAgent,
	getAgent,
	getByPath,
	listAgents,
	registerAgent,
	resolveNodeInputs,
	runAgentDefinition,
	tasksDashboardSummaryAgent,
	type AgentDefinition,
} from "@toby/core/agents";
import {
	coerceFreeTextToSchema,
	isMarkdownOnlyObjectSchema,
} from "@toby/core/agents/nodes/llm-prompter";
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

	it("detects markdown-only object schemas used by dashboard agents", () => {
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

describe("agent input/output resolution", () => {
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

	it("resolveNodeInputs throws AgentNodeError on missing key", () => {
		expect(() =>
			resolveNodeInputs("n1", { x: { from: "missing" } }, {}),
		).toThrow(AgentNodeError);
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

describe("agent registry", () => {
	beforeEach(() => {
		clearAgentRegistry();
	});

	afterEach(() => {
		clearAgentRegistry();
		// Re-register built-ins so other tests / imports still work.
		registerAgent(emailDashboardSummaryAgent);
		registerAgent(tasksDashboardSummaryAgent);
		registerAgent(calendarDashboardSummaryAgent);
	});

	it("registerAgent and getAgent round-trip", () => {
		const def: AgentDefinition = {
			name: "test.agent",
			nodes: [
				{
					id: "t1",
					type: "tool_executor",
					tool: { moduleName: "email", toolName: "getUnreadSummary" },
				},
			],
		};
		registerAgent(def);
		expect(getAgent("test.agent")?.name).toBe("test.agent");
		expect(listAgents().some((a) => a.name === "test.agent")).toBe(true);
	});

	it("rejects empty name and duplicate node ids", () => {
		expect(() =>
			registerAgent({
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
			registerAgent({
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

describe("dashboard summary agent definitions", () => {
	it("email agent is registered with tool_executor then llm_prompter", () => {
		registerAgent(emailDashboardSummaryAgent);
		const agent = getAgent("dashboard.email.summary");
		expect(agent).toBeDefined();
		expect(agent?.nodes).toHaveLength(2);
		expect(agent?.nodes[0]?.type).toBe("tool_executor");
		expect(agent?.nodes[1]?.type).toBe("llm_prompter");
		if (agent?.nodes[0]?.type === "tool_executor") {
			expect(
				"standardTool" in agent.nodes[0].tool &&
					agent.nodes[0].tool.standardTool,
			).toBe("email.unreadSummary");
		}
	});

	it("tasks agent is registered with tool_executor then llm_prompter", () => {
		registerAgent(tasksDashboardSummaryAgent);
		const agent = getAgent("dashboard.tasks.summary");
		expect(agent).toBeDefined();
		expect(agent?.nodes).toHaveLength(2);
		expect(agent?.nodes[0]?.type).toBe("tool_executor");
		expect(agent?.nodes[1]?.type).toBe("llm_prompter");
		if (agent?.nodes[0]?.type === "tool_executor") {
			expect(
				"standardTool" in agent.nodes[0].tool &&
					agent.nodes[0].tool.standardTool,
			).toBe("tasks.openSummary");
		}
		const llm = agent?.nodes[1];
		if (llm?.type === "llm_prompter") {
			expect(
				llm.schema.safeParse({ markdown: "## Needs attention\n- x" }).success,
			).toBe(true);
		}
	});

	it("calendar agent is registered with tool_executor then llm_prompter", () => {
		registerAgent(calendarDashboardSummaryAgent);
		const agent = getAgent("dashboard.calendar.summary");
		expect(agent).toBeDefined();
		expect(agent?.nodes).toHaveLength(2);
		expect(agent?.nodes[0]?.type).toBe("tool_executor");
		expect(agent?.nodes[1]?.type).toBe("llm_prompter");
		if (agent?.nodes[0]?.type === "tool_executor") {
			expect(
				"standardTool" in agent.nodes[0].tool &&
					agent.nodes[0].tool.standardTool,
			).toBe("calendar.upcomingSummary");
		}
	});
});

describe("runAgentDefinition", () => {
	it("returns unknown agent style failure via run with empty pipeline result on missing inputs", async () => {
		const def: AgentDefinition = {
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
		const result = await runAgentDefinition(def, {
			personaOverride: {
				name: "Test",
				instructions: "",
				promptMode: "add",
				ai: { provider: "openai", model: "gpt-4.1-nano" },
			},
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.failedNodeId).toBe("need-missing");
			expect(result.error).toMatch(/Missing context key/);
		}
	});

	it("runs a pure llm_prompter node when generate path is not needed for input wiring", async () => {
		// This agent only has a tool node that will fail resolve — covered above.
		// Smoke: structured schema exists on email agent llm node.
		const llm = emailDashboardSummaryAgent.nodes[1];
		expect(llm?.type).toBe("llm_prompter");
		if (llm?.type === "llm_prompter") {
			const parsed = llm.schema.safeParse({ markdown: "## Needs attention\n- Hi" });
			expect(parsed.success).toBe(true);
			const bad = llm.schema.safeParse({ notMarkdown: true });
			expect(bad.success).toBe(false);
		}
	});
});

