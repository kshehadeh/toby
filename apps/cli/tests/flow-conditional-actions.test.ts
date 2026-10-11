import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	createFlowAuthoringTools,
	flowDraftSchema,
} from "@toby/core/ai/flow-authoring-tools";
import {
	type FlowDocument,
	extractFlowResult,
	getFlowRun,
	hydrateFlowDocument,
	parseUserFlowDocumentBody,
	runFlowDefinition,
	schemaFromSpec,
	validateUserFlowDocument,
} from "@toby/core/flows";
import { coerceFreeTextToSchema } from "@toby/core/flows/nodes/llm-prompter";
import { closeChatDbForTests } from "@toby/core/session-store";
import { saveUserTool } from "@toby/core/user-tools/store";
import { generateTextMock, generateTextQueue } from "./helpers/setup-mocks";

let priorDir: string | undefined;
let dir: string;
beforeEach(() => {
	priorDir = process.env.TOBY_DIR;
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-conditional-flow-"));
	process.env.TOBY_DIR = dir;
	generateTextQueue.length = 0;
	generateTextMock.mockClear();
});
afterEach(() => {
	generateTextQueue.length = 0;
	closeChatDbForTests();
	if (priorDir === undefined) Reflect.deleteProperty(process.env, "TOBY_DIR");
	else process.env.TOBY_DIR = priorDir;
	fs.rmSync(dir, { recursive: true, force: true });
});
const persona = {
	name: "Test",
	instructions: "",
	promptMode: "add" as const,
	ai: { provider: "ollama" as const, model: "test" },
};
const schemaSpec = {
	kind: "object" as const,
	fields: {
		shouldNotify: {
			type: "boolean" as const,
			description: "Whether a meeting is coming",
		},
		title: { type: "string" as const },
		description: { type: "string" as const },
	},
};
function reminder(): FlowDocument {
	const tool = saveUserTool({
		name: "Notification stand-in",
		description: "",
		language: "typescript",
		inputNames: ["title", "description"],
		outputKind: "json",
		source: "export default (input) => input",
	});
	return {
		id: "flow.test.reminder",
		name: "Reminder",
		nodes: [
			{
				id: "think",
				type: "llm_prompter",
				schema: schemaSpec,
				systemPrompt: "Decide whether a meeting is coming",
				userPrompt: "Check meetings",
				outputs: { decision: "object" },
			},
			{
				id: "notify",
				type: "tool_executor",
				tool: { userToolId: tool.id },
				when: { from: "decision", path: "shouldNotify" },
				inputs: {
					title: { from: "decision", path: "title" },
					description: { from: "decision", path: "description" },
				},
				outputs: { notification: "result" },
			},
		],
	};
}

describe("structured flow actions", () => {
	it("runs an action with validated LLM fields when the decision is true", async () => {
		const doc = reminder();
		const output = {
			shouldNotify: true,
			title: "Meeting",
			description: "Design review in five minutes",
		};
		generateTextQueue.push({ output });
		const result = await runFlowDefinition(hydrateFlowDocument(doc), {
			personaOverride: persona,
		});
		expect(result.ok).toBe(true);
		expect(result.outputs.notification).toEqual({
			title: output.title,
			description: output.description,
		});
		expect(result.nodeTrace.map((node) => node.status)).toEqual([
			"success",
			"success",
		]);
		expect(
			getFlowRun(result.runId as string)?.definitionSnapshot.nodes[1].when,
		).toEqual(
			doc.nodes[1].type === "tool_executor" ? doc.nodes[1].when : undefined,
		);
	});

	it("skips without resolving action arguments or calling a tool when false, and persists the reason", async () => {
		const doc = reminder();
		// A false condition must skip even if an action input path is absent.
		(doc.nodes[1] as { inputs: unknown }).inputs = {
			description: { from: "missing" },
		};
		generateTextQueue.push({
			output: { shouldNotify: false, title: "", description: "" },
		});
		const result = await runFlowDefinition(hydrateFlowDocument(doc), {
			personaOverride: persona,
		});
		expect(result.ok).toBe(true);
		expect(result.outputs.notification).toBeUndefined();
		expect(result.nodeTrace[1]).toMatchObject({
			status: "skipped",
			inputs: {},
			bagWrites: {},
			nodeResult: { reason: "Action condition was false", value: false },
		});
		const history = getFlowRun(result.runId as string);
		expect(history?.nodes[1].status).toBe("skipped");
		expect(history?.nodes[1].outputs).toMatchObject({
			nodeResult: { skipped: true, value: false },
		});
		expect(
			extractFlowResult(result.outputs, doc, {
				lastNodeResult: result.nodeTrace[1].nodeResult,
			}).text,
		).toContain("skipped");
	});

	it("continues with subsequent actions after a skipped action", async () => {
		const doc = reminder();
		const action = doc.nodes[1];
		if (action.type !== "tool_executor") throw new Error("Expected action");
		generateTextQueue.push({
			output: { shouldNotify: false, title: "", description: "" },
		});
		const result = await runFlowDefinition(
			hydrateFlowDocument({
				...doc,
				nodes: [
					...doc.nodes,
					{
						...action,
						id: "always",
						when: undefined,
						inputs: {
							title: { const: "Done" },
							description: { const: "Checked" },
						},
					},
				],
			}),
			{ personaOverride: persona },
		);
		expect(result.ok).toBe(true);
		expect(result.nodeTrace.map((node) => [node.order, node.status])).toEqual([
			[0, "success"],
			[1, "skipped"],
			[2, "success"],
		]);
		expect(result.outputs.notification).toEqual({
			title: "Done",
			description: "Checked",
		});
	});

	it("stops before action execution for missing or non-boolean conditions", async () => {
		for (const decision of [
			{},
			{ shouldNotify: "false" },
			{ shouldNotify: 0 },
			{ shouldNotify: null },
		]) {
			const doc = reminder();
			const result = await runFlowDefinition(
				hydrateFlowDocument({ ...doc, nodes: [doc.nodes[1]] }),
				{ personaOverride: persona, inputs: { decision }, record: false },
			);
			expect(result.ok).toBe(false);
			expect(result.nodeTrace[0].status).toBe("error");
			expect(result.nodeTrace[0].detail).toBeUndefined();
		}
	});

	it("rejects invalid model output and uses a schema-directed JSON fallback", async () => {
		const doc = reminder();
		generateTextQueue.push(
			{ output: { shouldNotify: "yes" } },
			{
				text: JSON.stringify({
					shouldNotify: false,
					title: "",
					description: "",
				}),
			},
		);
		const result = await runFlowDefinition(hydrateFlowDocument(doc), {
			personaOverride: persona,
			record: false,
		});
		expect(result.ok).toBe(true);
		expect(result.nodeTrace[1].status).toBe("skipped");
		const options = generateTextMock.mock.calls[1][0] as {
			instructions: string;
		};
		expect(options.instructions).toContain("JSON object matching this schema");
		expect(options.instructions).toContain("shouldNotify");
	});

	it("does not run an action when both model attempts return invalid output", async () => {
		generateTextQueue.push(
			{ output: { shouldNotify: "yes" } },
			{ text: "No meetings" },
		);
		const result = await runFlowDefinition(hydrateFlowDocument(reminder()), {
			personaOverride: persona,
			record: false,
		});
		expect(result.ok).toBe(false);
		expect(result.nodeTrace).toHaveLength(1);
	});

	it("renders a structured-only result and records the schema in history", async () => {
		const doc = reminder();
		const output = {
			shouldNotify: false,
			title: "",
			description: "No meetings",
		};
		generateTextQueue.push({ output });
		const structuredOnly = { ...doc, nodes: [doc.nodes[0]] };
		const result = await runFlowDefinition(
			hydrateFlowDocument(structuredOnly),
			{ personaOverride: persona },
		);
		expect(result.ok).toBe(true);
		expect(extractFlowResult(result.outputs, structuredOnly).text).toContain(
			"No meetings",
		);
		expect(
			getFlowRun(result.runId as string)?.definitionSnapshot.nodes[0].schema,
		).toEqual(schemaSpec);
	});

	it("requires exact field types, all fields, and safe schema names", () => {
		const schema = schemaFromSpec(schemaSpec);
		expect(
			schema.safeParse({ shouldNotify: false, title: "", description: "" })
				.success,
		).toBe(true);
		expect(coerceFreeTextToSchema(schema, "No meetings")).toBeNull();
		expect(
			coerceFreeTextToSchema(
				schema,
				'{"shouldNotify":"false","title":"","description":""}',
			),
		).toBeNull();
		for (const spec of [
			{ kind: "object", fields: {} },
			{ kind: "object", fields: { constructor: { type: "string" } } },
			{ kind: "object", fields: { items: { type: "array" } } },
			{ kind: "unknown" },
		]) {
			expect(() => schemaFromSpec(spec as never)).toThrow();
		}
	});

	it("parses schemas and conditions without downgrading invalid definitions", () => {
		const doc = reminder();
		const parsed = parseUserFlowDocumentBody(
			doc as unknown as Record<string, unknown>,
			doc.id,
		);
		expect(parsed.nodes).toEqual(doc.nodes);
		expect(() =>
			parseUserFlowDocumentBody(
				{ ...doc, nodes: [{ ...doc.nodes[0], when: { from: "decision" } }] },
				doc.id,
			),
		).toThrow(/only on tool actions/);
		for (const when of [
			null,
			{},
			{ from: "decision", path: 1 },
			{ const: true },
		]) {
			expect(() =>
				parseUserFlowDocumentBody(
					{ ...doc, nodes: [{ ...doc.nodes[1], when }] },
					doc.id,
				),
			).toThrow();
		}
		expect(() =>
			parseUserFlowDocumentBody(
				{ ...doc, nodes: [{ ...doc.nodes[0], schema: { kind: "unknown" } }] },
				doc.id,
			),
		).toThrow();
	});

	it("creates a conditional structured flow through chat authoring without executing it", async () => {
		const doc = reminder();
		const draft = flowDraftSchema.parse(doc);
		const actions: string[] = [];
		const tools = createFlowAuthoringTools({
			dryRun: true,
			appliedActions: actions,
		});
		const result = await tools.createFlow.execute?.(draft, {
			toolCallId: "create",
			messages: [],
		});
		expect(result).toMatchObject({
			ok: true,
			dryRun: true,
			document: { nodes: doc.nodes },
		});
		expect(actions).toEqual([]);
		expect(generateTextMock).not.toHaveBeenCalled();
	});

	it("validates condition references and rejects forward and prototype paths", () => {
		const doc = reminder();
		const options = { tools: [], connectedModules: [] };
		// Script tools resolve from the store, without needing a plugin catalog.
		expect(() => validateUserFlowDocument(doc, options)).not.toThrow();
		for (const when of [
			{ from: "later" },
			{ from: "decision", path: "constructor.prototype" },
		]) {
			expect(() =>
				validateUserFlowDocument(
					{ ...doc, nodes: [doc.nodes[0], { ...doc.nodes[1], when } as never] },
					options,
				),
			).toThrow(/condition/);
		}
	});
});
