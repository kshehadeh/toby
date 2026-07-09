import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeChatDbForTests } from "@toby/core/session-store";
import { handleWebRequest } from "@toby/core/web/routes";

function canUseBunSqlite(): boolean {
	try {
		// biome-ignore lint/suspicious/noExplicitAny: runtime probe
		require("bun:sqlite" as any);
		return true;
	} catch {
		return false;
	}
}

function withTempTobyDir(run: () => void | Promise<void>): Promise<void> {
	const previous = process.env.TOBY_DIR;
	const previousPlugins = process.env.TOBY_PLUGINS_DIR;
	const dir = fs.mkdtempSync(
		path.join(os.tmpdir(), "toby-native-app-api-test-"),
	);
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

describe("native app API fresh state", () => {
	afterEach(() => {
		closeChatDbForTests();
	});

	it("GET /api/status returns default persona and empty integrations", async () => {
		await withTempTobyDir(async () => {
			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/status"),
				null,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				version: string;
				persona: string;
				model: string;
				tobyDir: string;
				connectedIntegrations: string[];
				personaCount: number;
				skillCount: number;
				skills: Array<{ name: string; description: string }>;
			};
			expect(body.version.length).toBeGreaterThan(0);
			expect(body.persona.length).toBeGreaterThan(0);
			expect(body.model.length).toBeGreaterThan(0);
			expect(body.tobyDir).toBe(process.env.TOBY_DIR);
			expect(body.connectedIntegrations).toEqual([]);
			expect(body.personaCount).toBe(1);
			expect(body.skillCount).toBe(0);
			expect(body.skills).toEqual([]);
		});
	});

	it("GET /api/daemon/status returns process info", async () => {
		await withTempTobyDir(async () => {
			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/daemon/status"),
				null,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				process?: { pid: number; uptimeSeconds: number; logPath: string };
				chatInbound: { enabled: boolean; status: string };
			};
			expect(body.chatInbound).toMatchObject({
				enabled: expect.any(Boolean),
				status: expect.any(String),
			});
			if (body.process) {
				expect(body.process.pid).toEqual(expect.any(Number));
				expect(body.process.uptimeSeconds).toEqual(expect.any(Number));
				expect(body.process.logPath).toEqual(expect.any(String));
			}
		});
	});

	it.skipIf(!canUseBunSqlite())(
		"GET /api/sessions returns empty list",
		async () => {
			await withTempTobyDir(async () => {
				const res = await handleWebRequest(
					new Request("http://127.0.0.1/api/sessions?limit=10"),
					null,
				);
				expect(res.status).toBe(200);
				const body = (await res.json()) as { sessions: unknown[] };
				expect(body.sessions).toEqual([]);
			});
		},
	);

	it.skipIf(!canUseBunSqlite())(
		"POST /api/sessions creates a session",
		async () => {
			await withTempTobyDir(async () => {
				const res = await handleWebRequest(
					new Request("http://127.0.0.1/api/sessions", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ name: "Test Session" }),
					}),
					null,
				);
				expect(res.status).toBe(201);
				const body = (await res.json()) as {
					id: string;
					name: string;
					settings: Record<string, unknown>;
				};
				expect(body.id).toMatch(
					/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
				);
				expect(body.name).toBe("Test Session");
				expect(body.settings).toEqual({});
			});
		},
	);

	it.skipIf(!canUseBunSqlite())(
		"GET /api/sessions/:id returns 404 for missing session",
		async () => {
			await withTempTobyDir(async () => {
				const res = await handleWebRequest(
					new Request(
						"http://127.0.0.1/api/sessions/00000000-0000-0000-0000-000000000000",
					),
					null,
				);
				expect(res.status).toBe(404);
			});
		},
	);

	it("GET /api/personas returns built-in personas", async () => {
		await withTempTobyDir(async () => {
			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/personas"),
				null,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				personas: Array<{
					name: string;
					label: string;
					isDefault: boolean;
					isBuiltIn: boolean;
				}>;
			};
			expect(body.personas.length).toBeGreaterThan(0);
			const toby = body.personas.find((p) => p.name === "Toby");
			expect(toby).toBeDefined();
			expect(toby?.isBuiltIn).toBe(true);
		});
	});

	it("GET /api/personas/:name returns built-in persona detail", async () => {
		await withTempTobyDir(async () => {
			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/personas/Toby"),
				null,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				persona: {
					name: string;
					instructions: string;
					promptMode: string;
					provider: string;
					model: string;
					isBuiltIn: boolean;
				};
			};
			expect(body.persona.name).toBe("Toby");
			expect(body.persona.isBuiltIn).toBe(true);
			expect(typeof body.persona.instructions).toBe("string");
			expect(body.persona.instructions.length).toBeGreaterThan(0);
		});
	});

	it("GET /api/configure/tree returns tree with no integrations", async () => {
		await withTempTobyDir(async () => {
			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/configure/tree"),
				null,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				tree: { label: string; kind: string };
				values: Record<string, string>;
				integrationLabels: Record<string, string>;
			};
			expect(body.tree.label).toBeDefined();
			expect(body.tree.kind).toBe("section");
			// No integrations means no integration-specific labels
			expect(Object.keys(body.integrationLabels)).toContain("(none)");
		});
	});

	it("GET /api/configure/sections returns sections", async () => {
		await withTempTobyDir(async () => {
			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/configure/sections"),
				null,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				sections: Array<{ label: string; kind: string; key: string }>;
			};
			expect(body.sections.length).toBeGreaterThan(0);
			const keys = body.sections.map((s) => s.key);
			expect(keys).toContain("chatInbound");
			expect(keys).toContain("defaults");
			expect(keys).toContain("ai");
		});
	});

	it("GET /api/plugins returns empty or plugin list", async () => {
		await withTempTobyDir(async () => {
			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/plugins"),
				null,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				plugins: Array<{
					name: string;
					displayName: string;
					state: string;
					connected: boolean;
					version: string | null;
				}>;
			};
			expect(Array.isArray(body.plugins)).toBe(true);
			// In fresh state, there may be 0 plugins installed
			for (const plugin of body.plugins) {
				expect(plugin.name).toEqual(expect.any(String));
				expect(plugin.displayName).toEqual(expect.any(String));
				expect(["valid", "invalid", "disabled"]).toContain(plugin.state);
				expect(typeof plugin.connected).toBe("boolean");
			}
		});
	});

	it("GET /api/integrations/:name/status returns 404 when plugin not installed", async () => {
		await withTempTobyDir(async () => {
			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/integrations/gmail/status"),
				null,
			);
			// When no plugins are installed, the integration is not found
			expect(res.status).toBe(404);
		});
	});

	it("GET /api/skills returns empty list", async () => {
		await withTempTobyDir(async () => {
			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/skills"),
				null,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				skills: Array<{ name: string; description: string }>;
			};
			expect(body.skills).toEqual([]);
		});
	});

	it("GET /api/ai/providers returns built-in providers with configured flags", async () => {
		await withTempTobyDir(async () => {
			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/ai/providers"),
				null,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				providers: Array<{
					id: string;
					displayName: string;
					models: string[];
					allowCustomModel: boolean;
					configured: boolean;
				}>;
			};
			expect(body.providers.length).toBeGreaterThan(0);
			const openai = body.providers.find((p) => p.id === "openai");
			expect(openai).toBeDefined();
			expect(openai?.displayName).toBe("OpenAI");
			expect(openai?.models.length).toBeGreaterThan(0);
			expect(typeof openai?.configured).toBe("boolean");
			expect(openai?.configured).toBe(false);
		});
	});

	it("POST /api/configure/actions/create-persona fails without configured AI provider", async () => {
		await withTempTobyDir(async () => {
			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/configure/actions/create-persona", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						name: "FreshTest",
						instructions: "Be helpful.",
						provider: "openai",
						model: "gpt-4.1",
						promptMode: "add",
					}),
				}),
				null,
			);
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: string };
			expect(body.error).toContain("not configured");
		});
	});

	it("POST /api/configure/actions/create-persona works with configured AI provider", async () => {
		await withTempTobyDir(async () => {
			// Seed OpenAI credentials
			const { writeCredentials } = await import("@toby/core/config/index");
			writeCredentials({ ai: { openai: { token: "sk-test" } } });

			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/configure/actions/create-persona", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						name: "FreshTest",
						instructions: "Be helpful.",
						provider: "openai",
						model: "gpt-4.1",
						promptMode: "add",
					}),
				}),
				null,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { ok: boolean; personaName: string };
			expect(body.ok).toBe(true);
			expect(body.personaName).toBe("FreshTest");
		});
	});
});
