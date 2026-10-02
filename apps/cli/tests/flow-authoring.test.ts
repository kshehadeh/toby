import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	createFlowAuthoringTools,
	flowDraftSchema,
} from "@toby/core/ai/flow-authoring-tools";
import {
	getFlowRecord,
	listFlowRecords,
} from "@toby/core/flows/definition-store";
import { extractFlowResult } from "@toby/core/flows/extract-result";
import { closeChatDbForTests } from "@toby/core/session-store";
import { ensureBuiltinSkills } from "@toby/core/skills/builtins";
import {
	collectToolsForSelectedSkills,
	loadLocalSkills,
} from "@toby/core/skills/index";
import { saveUserTool } from "@toby/core/user-tools/store";

describe("built-in flow authoring", () => {
	let dir: string;
	let previous: string | undefined;
	beforeEach(() => {
		closeChatDbForTests();
		previous = process.env.TOBY_DIR;
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-flow-authoring-"));
		process.env.TOBY_DIR = dir;
	});
	afterEach(() => {
		closeChatDbForTests();
		if (previous === undefined) Reflect.deleteProperty(process.env, "TOBY_DIR");
		else process.env.TOBY_DIR = previous;
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("installs the skill in the default catalog and scopes its authoring tools", () => {
		const skills = loadLocalSkills();
		expect(skills.map((skill) => skill.name)).toContain("flow-builder");
		expect(
			collectToolsForSelectedSkills({
				selectedSkillNames: ["flow-builder"],
				skills,
				allowedToolNamesLower: new Set([
					"listflowauthoringcatalog",
					"createflow",
					"askuser",
				]),
				toolIntegrationLabels: {},
			}),
		).toEqual(["listFlowAuthoringCatalog", "createFlow", "askUser"]);
		expect(loadLocalSkills(path.join(dir, "project-skills"))).toEqual([]);
	});

	it("preserves an existing skill, its disabled state, and deletion", () => {
		const root = path.join(dir, "skills");
		const folder = path.join(root, "flow-builder");
		fs.mkdirSync(folder, { recursive: true });
		const content =
			"---\nname: flow-builder\ndescription: My custom instructions\nenabled: false\n---\nCustom body\n";
		fs.writeFileSync(path.join(folder, "SKILL.md"), content);
		ensureBuiltinSkills(root);
		expect(loadLocalSkills()[0]?.enabled).toBe(false);
		expect(fs.readFileSync(path.join(folder, "SKILL.md"), "utf8")).toBe(
			content,
		);
		fs.rmSync(folder, { recursive: true });
		expect(loadLocalSkills()).toEqual([]);
	});

	it("lists saved script metadata without executing the script", async () => {
		const script = saveUserTool({
			name: "Example",
			description: "Example script",
			language: "typescript",
			inputNames: ["topic"],
			outputKind: "text",
			source:
				'export default async () => { throw new Error("Must not run"); };',
		});
		const tools = createFlowAuthoringTools({
			dryRun: false,
			appliedActions: [],
		});
		const catalog = await tools.listFlowAuthoringCatalog.execute?.(
			{},
			{
				toolCallId: "catalog",
				messages: [],
			},
		);
		expect(catalog?.scriptTools).toEqual([
			{
				userToolId: script.id,
				name: "Example",
				description: "Example script",
				language: "typescript",
				inputNames: ["topic"],
				outputKind: "text",
			},
		]);
	});

	it("saves a Home action with script and final LLM steps without running them", async () => {
		const script = saveUserTool({
			name: "Gather context",
			description: "Read context",
			language: "typescript",
			inputNames: ["topic"],
			outputKind: "json",
			source:
				'export default async () => { throw new Error("Must not run"); };',
		});
		const draft = flowDraftSchema.parse({
			name: "Context brief",
			nodes: [
				{
					id: "context",
					type: "tool_executor",
					tool: { userToolId: script.id },
					inputs: { topic: { const: "Today" } },
					outputs: { context: "result" },
				},
				{
					id: "brief",
					type: "llm_prompter",
					schema: { kind: "markdown" },
					systemPrompt: "Write a brief from the supplied context.",
					userPrompt: "{{json bag.context}}",
					outputs: { summary: "object" },
				},
			],
			result: { from: "summary", path: "markdown" },
			destinations: [
				{ type: "modal" },
				{ type: "dashboard", variant: "runner" },
			],
		});
		const actions: string[] = [];
		const dryTools = createFlowAuthoringTools({
			dryRun: true,
			appliedActions: actions,
		});
		const preview = await dryTools.createFlow.execute?.(draft, {
			toolCallId: "preview",
			messages: [],
		});
		expect(preview).toMatchObject({ ok: true, dryRun: true });
		expect(listFlowRecords().filter((flow) => !flow.builtin)).toHaveLength(0);
		expect(actions).toEqual([]);
		const tools = createFlowAuthoringTools({
			dryRun: false,
			appliedActions: actions,
		});
		const saved = await tools.createFlow.execute?.(draft, {
			toolCallId: "save",
			messages: [],
		});
		expect(saved?.ok).toBe(true);
		if (!saved || !("id" in saved)) throw new Error("Flow was not saved");
		expect(getFlowRecord(saved.id)?.document).toMatchObject(draft);
		expect(actions).toHaveLength(1);
		expect(
			extractFlowResult(
				{ summary: { markdown: "A useful brief" } },
				saved.document,
			),
		).toMatchObject({ text: "A useful brief", format: "markdown" });
	});

	it("returns validation issues and saves nothing for unknown script tools", async () => {
		const tools = createFlowAuthoringTools({
			dryRun: false,
			appliedActions: [],
		});
		const result = await tools.createFlow.execute?.(
			{
				name: "Invalid",
				nodes: [
					{
						id: "missing",
						type: "tool_executor",
						tool: { userToolId: "tool.missing" },
					},
				],
			},
			{ toolCallId: "invalid", messages: [] },
		);
		expect(result).toMatchObject({ ok: false });
		expect(
			result && "issues" in result && result.issues?.length,
		).toBeGreaterThan(0);
		expect(listFlowRecords().filter((flow) => !flow.builtin)).toHaveLength(0);
	});
});
