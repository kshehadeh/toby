import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	deleteUserFlowDocument,
	saveUserFlowDocument,
} from "@toby/core/flows/definition-store";
import { runFlow } from "@toby/core/flows/runner";
import { closeChatDbForTests } from "@toby/core/session-store";
import { executeUserToolById } from "@toby/core/user-tools/execute";
import {
	extractGeneratedScript,
	generateUserToolSource,
	parseScriptGenerationRequest,
	scriptGenerationPrompt,
} from "@toby/core/user-tools/generate";
import {
	deleteUserTool,
	getUserTool,
	listToolUses,
	listUserTools,
	saveUserTool,
} from "@toby/core/user-tools/store";
import { handleUserToolGenerate } from "@toby/core/web/handlers/user-tools";
import { handleWebRequest } from "@toby/core/web/routes";

let priorDir: string | undefined;
let dir: string;
beforeEach(() => {
	priorDir = process.env.TOBY_DIR;
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-script-tools-test-"));
	process.env.TOBY_DIR = dir;
});
afterEach(() => {
	closeChatDbForTests();
	if (priorDir === undefined) Reflect.deleteProperty(process.env, "TOBY_DIR");
	else process.env.TOBY_DIR = priorDir;
	fs.rmSync(dir, { recursive: true, force: true });
});

describe("user script tools", () => {
	it("generates code from the current settings without saving it", async () => {
		const body = {
			instruction: "Show the selected Finder item's name",
			name: "Finder selection",
			description: "Return the selected item's name",
			language: "applescript",
			inputNames: ["fallbackName"],
			outputKind: "text",
			source: "on run argv\n  return item 1 of argv\nend run",
		};
		const request = parseScriptGenerationRequest(body);
		const { instructions, prompt } = scriptGenerationPrompt(request);
		expect(instructions).toContain("on run argv");
		expect(instructions).toContain("quoted form");
		expect(instructions).toContain("/usr/bin/osascript");
		expect(prompt).toContain(body.instruction);
		expect(prompt).toContain(body.description);
		expect(prompt).toContain("fallbackName");
		expect(prompt).toContain(body.source);
		const generated = await generateUserToolSource(
			request,
			async () =>
				"```applescript\non run argv\n  return item 1 of argv\nend run\n```",
		);
		expect(generated).toBe(body.source);
		const response = await handleUserToolGenerate(
			new Request("http://127.0.0.1/api/user-tools/generate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			}),
			async () => generated,
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ source: body.source });
		expect(listUserTools()).toHaveLength(0);
	});

	it("validates generation and gives TypeScript only Bun runtime imports", async () => {
		const request = parseScriptGenerationRequest({
			instruction: "Return a greeting",
			name: "",
			description: "",
			language: "typescript",
			inputNames: [],
			outputKind: "text",
			source: "",
		});
		const { instructions } = scriptGenerationPrompt(request);
		expect(instructions).toContain("node:*");
		expect(instructions).toContain("Do not import npm packages");
		expect(
			extractGeneratedScript(
				"export default async function run() { return 'Hi'; }",
				"typescript",
			),
		).toContain("export default");
		expect(() =>
			extractGeneratedScript("Here is a script", "typescript"),
		).toThrow();
		expect(() =>
			parseScriptGenerationRequest({ ...request, instruction: " " }),
		).toThrow();
		const foreign = await handleWebRequest(
			new Request("http://127.0.0.1/api/user-tools/generate", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Origin: "https://example.com",
				},
				body: JSON.stringify(request),
			}),
			null,
		);
		expect(foreign.status).toBe(403);
	});

	it("tests an unsaved draft without adding or revising a library tool", async () => {
		const url = "http://127.0.0.1/api/user-tools/test";
		const draft = {
			language: "typescript",
			inputNames: ["name"],
			outputKind: "text",
			source:
				"export default (input: { name: string }) => `Hello ${input.name}`",
			input: { name: "Ada" },
		};
		const request = (body: Record<string, unknown>, origin?: string) =>
			new Request(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(origin ? { Origin: origin } : {}),
				},
				body: JSON.stringify(body),
			});
		const blocked = await handleWebRequest(
			request(draft, "https://example.com"),
			null,
		);
		expect(blocked.status).toBe(403);
		const preview = await handleWebRequest(request(draft), null);
		expect(preview.status).toBe(200);
		expect(await preview.json()).toEqual({ ok: true, result: "Hello Ada" });
		expect(listUserTools()).toHaveLength(0);

		const saved = saveUserTool({
			name: "Greeting",
			description: "",
			language: "typescript",
			inputNames: ["name"],
			outputKind: "text",
			source: "export default () => 'Saved version'",
		});
		const changed = await handleWebRequest(
			request({ ...draft, source: "export default () => 'Draft version'" }),
			null,
		);
		expect(await changed.json()).toEqual({ ok: true, result: "Draft version" });
		expect(getUserTool(saved.id)?.currentRevision).toBe(1);
		expect(getUserTool(saved.id)?.source).toBe(saved.source);
	});

	it("accepts local JSON writes and rejects cross-origin or form writes", async () => {
		const url = "http://127.0.0.1/api/user-tools";
		const body = JSON.stringify({
			name: "Echo",
			description: "",
			language: "typescript",
			inputNames: [],
			outputKind: "text",
			source: "export default () => 'ok'",
		});
		const form = await handleWebRequest(
			new Request(url, {
				method: "POST",
				headers: { "Content-Type": "text/plain" },
				body,
			}),
			null,
		);
		expect(form.status).toBe(415);
		const foreign = await handleWebRequest(
			new Request(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Origin: "https://example.com",
				},
				body,
			}),
			null,
		);
		expect(foreign.status).toBe(403);
		const created = await handleWebRequest(
			new Request(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body,
			}),
			null,
		);
		expect(created.status).toBe(201);
	});

	it("executes TypeScript, keeps revisions, and protects tools used by flows", async () => {
		const created = saveUserTool({
			name: "Double",
			description: "Double a number",
			language: "typescript",
			inputNames: ["value"],
			outputKind: "json",
			source:
				"export default async function run(input: { value: number }) { return { doubled: input.value * 2 }; }",
		});
		expect(
			(await executeUserToolById(created.id, { value: 3 })).result,
		).toEqual({ doubled: 6 });
		const edited = saveUserTool(
			{
				...created,
				source:
					"export default async function run(input: { value: number }) { return { doubled: input.value * 3 }; }",
			},
			created.id,
		);
		expect(edited.currentRevision).toBe(2);
		expect(
			(await executeUserToolById(created.id, { value: 3 })).result,
		).toEqual({ doubled: 9 });
		saveUserFlowDocument({
			id: "flow.test.script",
			name: "Use Double",
			nodes: [
				{
					id: "calculate",
					type: "tool_executor",
					tool: { userToolId: created.id },
					inputs: { value: { const: 3 } },
				},
			],
		});
		expect(listToolUses(created.id)).toEqual(["flow.test.script"]);
		const run = await runFlow("flow.test.script", { record: false });
		expect(run.ok).toBe(true);
		if (run.ok) {
			expect(run.outputs.result).toEqual({ doubled: 9 });
			expect(run.nodeTrace[0]?.detail?.kind).toBe("tool_executor");
			if (run.nodeTrace[0]?.detail?.kind === "tool_executor") {
				expect(run.nodeTrace[0].detail.toolCalls[0]?.revision).toBe(2);
			}
		}
		expect(() => deleteUserTool(created.id)).toThrow("used by 1 flow");
		expect(getUserTool(created.id)?.currentRevision).toBe(2);
		deleteUserFlowDocument("flow.test.script");
		deleteUserTool(created.id);
		expect(getUserTool(created.id)).toBeNull();
	});

	it.skipIf(process.platform !== "darwin")(
		"executes AppleScript arguments and parses JSON output",
		async () => {
			const tool = saveUserTool({
				name: "Echo",
				description: "",
				language: "applescript",
				inputNames: ["value"],
				outputKind: "json",
				source:
					'on run argv\nreturn "{\\"echo\\":\\"" & item 1 of argv & "\\"}"\nend run',
			});
			expect(
				(await executeUserToolById(tool.id, { value: "hello" })).result,
			).toEqual({ echo: "hello" });
		},
	);
});
