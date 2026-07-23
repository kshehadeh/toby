import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	BUILTIN_FLOWS,
	type FlowDefinition,
	type FlowDocument,
	FlowNodeError,
	applyNodeOutputs,
	calendarDashboardSummaryDocument,
	emailDashboardSummaryDocument,
	getBuiltinFlowDocument,
	getByPath,
	getFlow,
	hydrateFlowDocument,
	listFlows,
	loadFlowRecord,
	removeFlowDocument,
	renderFlowPromptTemplate,
	resolveNodeInputs,
	runFlowDefinition,
	saveFlowDocument,
	schemaFromSpec,
	tasksDashboardSummaryDocument,
} from "@toby/core/flows";
import {
	coerceFreeTextToSchema,
	isMarkdownOnlyObjectSchema,
} from "@toby/core/flows/nodes/llm-prompter";
import { closeChatDbForTests } from "@toby/core/session-store";
import { z } from "zod";

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "toby-flows-"));
}

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
		const out = coerceFreeTextToSchema(markdownSchema, '{"markdown":"Hello"}');
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

describe("prompt templates", () => {
	const persona = {
		name: "Test",
		instructions: "",
		promptMode: "add" as const,
		ai: { provider: "openai" as const, model: "gpt-4.1-nano" },
	};

	it("renders bag, json bag, dashboardItems, and inputs tokens", () => {
		const bag = {
			unread: {
				count: 1,
				items: [
					{
						id: "1",
						title: "Hello",
						subtitle: "from bob",
					},
				],
			},
			plain: "x",
		};
		const ctx = {
			persona,
			bag,
			inputs: { data: { count: 1 } },
		};
		const out = renderFlowPromptTemplate(
			[
				"items:",
				"{{dashboardItems bag.unread}}",
				"json:",
				"{{json bag.unread}}",
				"bag:",
				"{{bag.plain}}",
				"in:",
				"{{inputs.data}}",
			].join("\n"),
			ctx,
		);
		expect(out).toContain("1. Hello");
		expect(out).toContain("from bob");
		expect(out).toContain('"count": 1');
		expect(out).toContain("bag:\nx");
		expect(out).toContain('in:\n{"count":1}');
	});
});

describe("hydrate + schema presets", () => {
	it("hydrates dashboard email document into tool then llm nodes", () => {
		const flow = hydrateFlowDocument(emailDashboardSummaryDocument);
		expect(flow.name).toBe("dashboard.email.summary");
		expect(flow.nodes).toHaveLength(2);
		expect(flow.nodes[0]?.type).toBe("tool_executor");
		expect(flow.nodes[1]?.type).toBe("llm_prompter");
		expect(flow.resolvePersona).toBeDefined();
		if (flow.nodes[0]?.type === "tool_executor") {
			expect(
				"standardTool" in flow.nodes[0].tool && flow.nodes[0].tool.standardTool,
			).toBe("email.unreadSummary");
		}
		if (flow.nodes[1]?.type === "llm_prompter") {
			expect(
				flow.nodes[1].schema.safeParse({ markdown: "## Needs attention\n- x" })
					.success,
			).toBe(true);
		}
	});

	it("schemaFromSpec markdown matches llm_prompter expectations", () => {
		const schema = schemaFromSpec({ kind: "markdown" });
		expect(isMarkdownOnlyObjectSchema(schema)).toBe(true);
		expect(schema.safeParse({ markdown: "hi" }).success).toBe(true);
	});
});

describe("flow definition store + seed-on-miss", () => {
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

	it("getFlow seeds built-in on first miss and does not duplicate", () => {
		expect(loadFlowRecord("dashboard.email.summary")).toBeNull();

		const flow = getFlow("dashboard.email.summary");
		expect(flow).toBeDefined();
		expect(flow?.name).toBe("dashboard.email.summary");
		expect(flow?.nodes).toHaveLength(2);
		expect(flow?.nodes[0]?.type).toBe("tool_executor");
		expect(flow?.nodes[1]?.type).toBe("llm_prompter");

		const row = loadFlowRecord("dashboard.email.summary");
		expect(row?.builtin).toBe(true);
		expect(row?.document.id).toBe("dashboard.email.summary");

		// Second lookup uses existing row (still present, same id).
		const again = getFlow("dashboard.email.summary");
		expect(again?.name).toBe("dashboard.email.summary");
		expect(loadFlowRecord("dashboard.email.summary")?.id).toBe(
			"dashboard.email.summary",
		);
	});

	it("listFlows ensures all built-in dashboard flows exist", () => {
		const flows = listFlows();
		const names = flows.map((f) => f.name);
		expect(names).toContain("dashboard.email.summary");
		expect(names).toContain("dashboard.tasks.summary");
		expect(names).toContain("dashboard.calendar.summary");
		expect(Object.keys(BUILTIN_FLOWS)).toHaveLength(3);
	});

	it("does not overwrite an existing built-in row when ensuring", () => {
		const custom: FlowDocument = {
			...emailDashboardSummaryDocument,
			description: "user-edited description",
		};
		saveFlowDocument(custom, { builtin: true });
		expect(
			loadFlowRecord("dashboard.email.summary")?.document.description,
		).toBe("user-edited description");

		// getFlow should return existing, not re-seed from code defaults.
		const flow = getFlow("dashboard.email.summary");
		expect(flow?.description).toBe("user-edited description");
	});

	it("saveFlowDocument round-trips a tool-only user flow", () => {
		const doc: FlowDocument = {
			id: "test.user.flow",
			name: "test.user.flow",
			description: "test",
			nodes: [
				{
					id: "t1",
					type: "tool_executor",
					tool: { moduleName: "email", toolName: "getUnreadSummary" },
				},
			],
		};
		const saved = saveFlowDocument(doc);
		expect(saved.name).toBe("test.user.flow");
		expect(getFlow("test.user.flow")?.nodes[0]?.type).toBe("tool_executor");
		expect(removeFlowDocument("test.user.flow")).toBe(true);
		expect(getFlow("test.user.flow")).toBeUndefined();
	});

	it("tasks and calendar built-in documents have expected tools", () => {
		const tasks = getBuiltinFlowDocument("dashboard.tasks.summary");
		const cal = getBuiltinFlowDocument("dashboard.calendar.summary");
		expect(tasks?.nodes[0]).toMatchObject({
			type: "tool_executor",
			tool: { standardTool: "tasks.openSummary" },
		});
		expect(cal?.nodes[0]).toMatchObject({
			type: "tool_executor",
			tool: { standardTool: "calendar.upcomingSummary" },
		});
		// Documents match exported constants.
		expect(tasks).toEqual(tasksDashboardSummaryDocument);
		expect(cal).toEqual(calendarDashboardSummaryDocument);
	});
});

describe("runFlowDefinition", () => {
	it("returns failure on missing inputs", async () => {
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

	it("hydrated email llm schema accepts markdown object", () => {
		const flow = hydrateFlowDocument(emailDashboardSummaryDocument);
		const llm = flow.nodes[1];
		expect(llm?.type).toBe("llm_prompter");
		if (llm?.type === "llm_prompter") {
			const parsed = llm.schema.safeParse({
				markdown: "## Needs attention\n- Hi",
			});
			expect(parsed.success).toBe(true);
			const bad = llm.schema.safeParse({ notMarkdown: true });
			expect(bad.success).toBe(false);
		}
	});
});
