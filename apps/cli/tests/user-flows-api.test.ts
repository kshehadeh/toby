import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeChatDbForTests } from "@toby/core/session-store";
import { handleWebRequest } from "@toby/core/web/routes";

function withTempTobyDir(run: () => void | Promise<void>): Promise<void> {
	const previous = process.env.TOBY_DIR;
	const previousPlugins = process.env.TOBY_PLUGINS_DIR;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-user-flows-api-"));
	const pluginsDir = path.join(dir, "plugins");
	fs.mkdirSync(pluginsDir, { recursive: true });
	process.env.TOBY_DIR = dir;
	process.env.TOBY_PLUGINS_DIR = pluginsDir;
	return Promise.resolve()
		.then(run)
		.finally(() => {
			closeChatDbForTests();
			if (previous === undefined) {
				Reflect.deleteProperty(process.env, "TOBY_DIR");
			} else {
				process.env.TOBY_DIR = previous;
			}
			if (previousPlugins === undefined) {
				Reflect.deleteProperty(process.env, "TOBY_PLUGINS_DIR");
			} else {
				process.env.TOBY_PLUGINS_DIR = previousPlugins;
			}
			fs.rmSync(dir, { recursive: true, force: true });
		});
}

const llmOnlyBody = {
	name: "Status note",
	description: "Write a line",
	nodes: [
		{
			id: "note",
			type: "llm_prompter",
			schema: { kind: "markdown" },
			systemPrompt: "Write one sentence.",
			userPrompt: "Say hello.",
		},
	],
	destinations: [{ type: "modal" }],
};

describe("user flow HTTP API", () => {
	afterEach(() => {
		closeChatDbForTests();
	});

	it("GET /api/plugins includes tools from the integration registry", async () => {
		await withTempTobyDir(async () => {
			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/plugins"),
				null,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				plugins: Array<{ name: string; tools?: unknown[] }>;
			};
			expect(Array.isArray(body.plugins)).toBe(true);
			for (const plugin of body.plugins) {
				expect(Array.isArray(plugin.tools)).toBe(true);
			}
		});
	});

	it("GET /api/flows/catalog returns modules from the integration registry", async () => {
		await withTempTobyDir(async () => {
			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/flows/catalog"),
				null,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				modules: Array<{ name: string; tools: unknown[] }>;
			};
			expect(Array.isArray(body.modules)).toBe(true);
		});
	});

	it("GET /api/flows includes destinations on each item", async () => {
		await withTempTobyDir(async () => {
			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/flows"),
				null,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				flows: Array<{
					id: string;
					builtin: boolean;
					destinations: unknown[];
				}>;
			};
			expect(body.flows.length).toBeGreaterThan(0);
			expect(body.flows.every((flow) => Array.isArray(flow.destinations))).toBe(
				true,
			);
		});
	});

	it("POST /api/flows creates an LLM-only custom flow", async () => {
		await withTempTobyDir(async () => {
			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/flows", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(llmOnlyBody),
				}),
				null,
			);
			expect(res.status).toBe(201);
			const body = (await res.json()) as {
				flow: {
					id: string;
					name: string;
					builtin: boolean;
					destinations: Array<{ type: string }>;
				};
			};
			expect(body.flow.id.startsWith("flow.")).toBe(true);
			expect(body.flow.builtin).toBe(false);
			expect(body.flow.name).toBe("Status note");
			expect(body.flow.destinations).toEqual([{ type: "modal" }]);

			const detail = await handleWebRequest(
				new Request(`http://127.0.0.1/api/flows/${body.flow.id}`),
				null,
			);
			expect(detail.status).toBe(200);
			const detailBody = (await detail.json()) as {
				document: { nodes: Array<{ systemPrompt?: string }> };
			};
			expect(detailBody.document.nodes[0]?.systemPrompt).toBe(
				"Write one sentence.",
			);
		});
	});

	it("POST /api/flows rejects unknown tools and email dest without email", async () => {
		await withTempTobyDir(async () => {
			const toolRes = await handleWebRequest(
				new Request("http://127.0.0.1/api/flows", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						name: "Wifi",
						nodes: [
							{
								id: "wifi",
								type: "tool_executor",
								tool: { moduleName: "macos", toolName: "macWifiSetPower" },
								inputs: { enabled: { const: false } },
							},
						],
					}),
				}),
				null,
			);
			expect(toolRes.status).toBe(400);
			const toolBody = (await toolRes.json()) as { issues?: string[] };
			expect(toolBody.issues?.join(" ")).toMatch(/unknown tool/i);

			const emailRes = await handleWebRequest(
				new Request("http://127.0.0.1/api/flows", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						...llmOnlyBody,
						destinations: [
							{
								type: "email",
								to: ["me@example.com"],
								subject: "Hi",
							},
						],
					}),
				}),
				null,
			);
			expect(emailRes.status).toBe(400);
			const emailBody = (await emailRes.json()) as { issues?: string[] };
			expect(emailBody.issues?.join(" ")).toMatch(/Email is not connected/);
		});
	});

	it("refuses to edit or delete built-in flows", async () => {
		await withTempTobyDir(async () => {
			await handleWebRequest(new Request("http://127.0.0.1/api/flows"), null);
			const put = await handleWebRequest(
				new Request("http://127.0.0.1/api/flows/dashboard.email.summary", {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(llmOnlyBody),
				}),
				null,
			);
			expect(put.status).toBe(403);

			const del = await handleWebRequest(
				new Request("http://127.0.0.1/api/flows/dashboard.email.summary", {
					method: "DELETE",
				}),
				null,
			);
			expect(del.status).toBe(403);
		});
	});

	it("PUT and DELETE work for a custom flow", async () => {
		await withTempTobyDir(async () => {
			const created = await handleWebRequest(
				new Request("http://127.0.0.1/api/flows", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(llmOnlyBody),
				}),
				null,
			);
			const createdBody = (await created.json()) as { flow: { id: string } };
			const id = createdBody.flow.id;

			const put = await handleWebRequest(
				new Request(`http://127.0.0.1/api/flows/${id}`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						...llmOnlyBody,
						name: "Renamed note",
					}),
				}),
				null,
			);
			expect(put.status).toBe(200);
			const putBody = (await put.json()) as { flow: { name: string } };
			expect(putBody.flow.name).toBe("Renamed note");

			const del = await handleWebRequest(
				new Request(`http://127.0.0.1/api/flows/${id}`, {
					method: "DELETE",
				}),
				null,
			);
			expect(del.status).toBe(200);

			const delAgain = await handleWebRequest(
				new Request(`http://127.0.0.1/api/flows/${id}`, {
					method: "DELETE",
				}),
				null,
			);
			expect(delAgain.status).toBe(404);
		});
	});
});
