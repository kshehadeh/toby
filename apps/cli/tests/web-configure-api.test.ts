import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	readConfig,
	readCredentials,
	writeConfig,
	writeCredentials,
} from "@toby/core/config/index";
import {
	applyConfigureValuesPatch,
	collectSecretConfigureKeys,
	rebuildCustomModels,
	redactConfigureValues,
	seedConfigureValues,
} from "@toby/core/configure/persistence";
import { resetPluginModuleCache } from "@toby/core/integrations/plugins/registry";
import { closeChatDbForTests } from "@toby/core/session-store";
import { handleWebRequest } from "@toby/core/web/routes";

const repoRoot = path.resolve(import.meta.dirname, "..");
const slackCli = path.join(repoRoot, "../plugin-slack/src/cli.ts");
const onePixelPng = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
	"base64",
);

function writePluginWrapper(
	pluginDir: string,
	name: string,
	cliPath: string,
): void {
	fs.mkdirSync(pluginDir, { recursive: true });
	const wrapperPath = path.join(pluginDir, `toby-plugin-${name}`);
	const script = `#!/usr/bin/env bash\nexec bun ${JSON.stringify(cliPath)} "$@"\n`;
	fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
}

function writeIconPlugin(pluginDir: string): void {
	const dir = path.join(pluginDir, "toby-plugin-iconfixture");
	fs.mkdirSync(path.join(dir, "src"), { recursive: true });
	fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
	fs.writeFileSync(path.join(dir, "assets", "icon.png"), onePixelPng);
	fs.writeFileSync(
		path.join(dir, "manifest.json"),
		JSON.stringify(
			{
				name: "iconfixture",
				displayName: "Icon Fixture",
				description: "Plugin with a bundled icon asset",
				version: "1.0.0",
				protocolVersion: "1",
				runtime: { type: "bun", entry: "src/index.ts" },
				capabilities: [],
				icon: "✨",
				iconAsset: { path: "assets/icon.png", mimeType: "image/png" },
			},
			null,
			2,
		),
	);
	fs.writeFileSync(
		path.join(dir, "src", "index.ts"),
		`
const payload = {
	ok: true,
	name: "iconfixture",
	displayName: "Icon Fixture",
	description: "Plugin with a bundled icon asset",
	version: "1.0.0",
	protocolVersion: "1",
	capabilities: [],
	icon: "✨",
	iconAsset: { path: "assets/icon.png", mimeType: "image/png" },
	connected: false,
};
console.log(JSON.stringify(payload));
`,
	);
}

function writeNoIconPlugin(pluginDir: string): void {
	const dir = path.join(pluginDir, "toby-plugin-noiconfixture");
	fs.mkdirSync(path.join(dir, "src"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, "manifest.json"),
		JSON.stringify(
			{
				name: "noiconfixture",
				displayName: "No Icon Fixture",
				description: "Plugin without a bundled icon asset",
				version: "1.0.0",
				protocolVersion: "1",
				runtime: { type: "bun", entry: "src/index.ts" },
				capabilities: [],
			},
			null,
			2,
		),
	);
	fs.writeFileSync(
		path.join(dir, "src", "index.ts"),
		`
console.log(JSON.stringify({
	ok: true,
	name: "noiconfixture",
	displayName: "No Icon Fixture",
	description: "Plugin without a bundled icon asset",
	version: "1.0.0",
	protocolVersion: "1",
	capabilities: [],
	connected: false,
}));
`,
	);
}

function withTempTobyDir(run: () => void): void {
	const previous = process.env.TOBY_DIR;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-secret-test-"));
	process.env.TOBY_DIR = dir;
	try {
		run();
	} finally {
		closeChatDbForTests();
		if (previous === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previous;
		}
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

describe("configure persistence", () => {
	it("redacts masked credential values", () => {
		const values = {
			"ai.openai.token": "sk-secret",
			"chatInbound.enabled": "false",
		};
		const redacted = redactConfigureValues(values);
		expect(redacted["ai.openai.token"]).toBe("••••••");
		expect(redacted["chatInbound.enabled"]).toBe("false");
	});

	it("collects secret keys including integration masked fields", () => {
		const keys = collectSecretConfigureKeys();
		expect(keys.has("ai.openai.token")).toBe(true);
		expect(keys.has("ai.vercel.apiKey")).toBe(true);
		expect(keys.has("ai.ollama.apiKey")).toBe(true);
	});

	it("persists the non-secret ollama base URL to config", () => {
		withTempTobyDir(() => {
			applyConfigureValuesPatch({
				"ai.ollama.baseUrl": "http://192.168.1.50:11434/v1",
			});
			expect(seedConfigureValues()["ai.ollama.baseUrl"]).toBe(
				"http://192.168.1.50:11434/v1",
			);
		});
	});

	it("persists secret configure keys to credentials", () => {
		withTempTobyDir(() => {
			applyConfigureValuesPatch({ "ai.openai.token": "new-secret" });
			expect(readCredentials().ai?.openai?.token).toBe("new-secret");
		});
	});

	it("keeps an existing secret when the redacted placeholder is patched", () => {
		withTempTobyDir(() => {
			applyConfigureValuesPatch({ "ai.openai.token": "keep-me" });
			applyConfigureValuesPatch({ "ai.openai.token": "••••••" });
			expect(readCredentials().ai?.openai?.token).toBe("keep-me");
		});
	});

	it("seeds configure values without throwing", () => {
		withTempTobyDir(() => {
			const values = seedConfigureValues();
			expect(typeof values["chatInbound.enabled"]).toBe("string");
			expect(values["defaults.documents"]).toBe("(none)");
		});
	});

	it("persists documents default provider", () => {
		withTempTobyDir(() => {
			applyConfigureValuesPatch({ "defaults.documents": "notion" });
			expect(readConfig().defaultProviders?.documents).toBe("notion");
			expect(seedConfigureValues()["defaults.documents"]).toBe("notion");
		});
	});

	it("persists custom model list for a provider", () => {
		withTempTobyDir(() => {
			applyConfigureValuesPatch({
				"personas.Toby.name": "Toby",
				"personas.Toby.instructions": "",
				"personas.Toby.promptMode": "add",
				"personas.Toby.ai.provider": "ollama",
				"personas.Toby.ai.model": "my-custom-llama",
			});
			const values = seedConfigureValues();
			expect(values["personas.Toby.ai.model"]).toBe("my-custom-llama");
			const customModelsRaw = values["ai.customModels.ollama"] ?? "";
			const models = customModelsRaw.split("\n").filter(Boolean);
			expect(models).toContain("my-custom-llama");
		});
	});

	it("auto-adds custom models not in built-in list", () => {
		withTempTobyDir(() => {
			applyConfigureValuesPatch({
				"personas.Toby.name": "Toby",
				"personas.Toby.instructions": "",
				"personas.Toby.promptMode": "add",
				"personas.Toby.ai.provider": "ollama",
				"personas.Toby.ai.model": "phi3-mini",
			});
			const values = seedConfigureValues();
			const models = (values["ai.customModels.ollama"] ?? "")
				.split("\n")
				.filter(Boolean);
			expect(models).toContain("phi3-mini");
		});
	});

	it("persists built-in persona provider and model without full persona fields", () => {
		withTempTobyDir(() => {
			applyConfigureValuesPatch({
				"personas.Toby.ai.provider": "ollama",
				"personas.Toby.ai.model": "llama3.2",
			});

			const config = readConfig();
			expect(config.personas).toHaveLength(1);
			expect(config.personas[0]).toMatchObject({
				name: "Toby",
				ai: { provider: "ollama", model: "llama3.2" },
			});
			expect(config.personas[0]?.instructions.length).toBeGreaterThan(0);
			expect(config.personas[0]?.promptMode).toBe("add");
		});
	});

	it("does not add built-in models to custom list", () => {
		withTempTobyDir(() => {
			applyConfigureValuesPatch({
				"personas.Toby.name": "Toby",
				"personas.Toby.instructions": "",
				"personas.Toby.promptMode": "add",
				"personas.Toby.ai.provider": "ollama",
				"personas.Toby.ai.model": "llama3.2",
			});
			const values = seedConfigureValues();
			const models = (values["ai.customModels.ollama"] ?? "")
				.split("\n")
				.filter(Boolean);
			expect(models).not.toContain("llama3.2");
		});
	});
});

describe("rebuildCustomModels", () => {
	it("parses newline-separated custom models per provider", () => {
		const result = rebuildCustomModels({
			"ai.customModels.ollama": "phi3-mini\ngemma-custom",
			"ai.customModels.vercel": "xai/grok-5",
		});
		expect(result).toEqual({
			ollama: ["phi3-mini", "gemma-custom"],
			vercel: ["xai/grok-5"],
		});
	});

	it("de-duplicates model names", () => {
		const result = rebuildCustomModels({
			"ai.customModels.ollama": "phi3-mini\nphi3-mini",
		});
		expect(result).toEqual({ ollama: ["phi3-mini"] });
	});

	it("returns undefined when no custom models exist", () => {
		expect(rebuildCustomModels({})).toBeUndefined();
	});
});

describe("web API routes", () => {
	let tempDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-web-api-"));
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = path.join(tempDir, "toby-home");
		resetPluginModuleCache();
		const pluginDir = path.join(tempDir, "toby-home", "plugins");
		writePluginWrapper(pluginDir, "slack", slackCli);
		writeIconPlugin(pluginDir);
		writeNoIconPlugin(pluginDir);
		fs.mkdirSync(path.join(tempDir, "toby-home"), { recursive: true });
		fs.writeFileSync(
			path.join(tempDir, "toby-home", "credentials.json"),
			JSON.stringify({ ai: { openai: { token: "sk-test-token" } } }),
		);
	});

	afterEach(() => {
		if (previousTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		resetPluginModuleCache();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("handles GET /api/daemon/status", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/daemon/status"),
			null,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			process: { pid: number; uptimeSeconds: number; logPath: string };
			chatInbound: { enabled: boolean; status: string };
		};
		expect(body.chatInbound).toMatchObject({
			enabled: expect.any(Boolean),
			status: expect.any(String),
		});
		expect(body.process).toMatchObject({
			pid: expect.any(Number),
			uptimeSeconds: expect.any(Number),
			logPath: expect.any(String),
		});
	});

	it("handles GET /api/plugins", async () => {
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
				icon: string | null;
				iconUrl: string | null;
			}>;
		};
		expect(Array.isArray(body.plugins)).toBe(true);
		for (const plugin of body.plugins) {
			expect(plugin.name).toEqual(expect.any(String));
			expect(plugin.displayName).toEqual(expect.any(String));
			expect(["valid", "invalid", "disabled"]).toContain(plugin.state);
			expect(typeof plugin.connected).toBe("boolean");
		}
		const iconFixture = body.plugins.find((p) => p.name === "iconfixture");
		expect(iconFixture?.icon).toBe("✨");
		expect(iconFixture?.iconUrl).toBe("/api/plugins/iconfixture/icon");
	});

	it("serves plugin icon assets", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/plugins/iconfixture/icon"),
			null,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/png");
		expect(res.headers.get("Cache-Control")).toContain("max-age=");
		expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
	});

	it("returns 404 when a plugin has no icon asset", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/plugins/noiconfixture/icon"),
			null,
		);
		expect(res.status).toBe(404);
	});

	it("includes integration display names for configure selects", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/configure/tree"),
			null,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			tree: {
				children: Array<{
					key: string;
					children?: Array<{ key: string; iconUrl?: string }>;
				}>;
			};
			integrationLabels: Record<string, string>;
		};
		expect(body.integrationLabels.slack).toBe("Slack");
		expect(body.integrationLabels["(none)"]).toBe("None");
		const integrations = body.tree.children.find(
			(item) => item.key === "integrations",
		);
		const iconFixture = integrations?.children?.find(
			(item) => item.key === "iconfixture",
		);
		expect(iconFixture?.iconUrl).toBe("/api/plugins/iconfixture/icon");
	});

	it("GET /api/configure/sections returns 6 lightweight section structures", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/configure/sections"),
			null,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			sections: Array<{
				label: string;
				kind: string;
				key: string;
				children?: Array<{ kind: string }>;
			}>;
		};
		expect(body.sections).toHaveLength(6);
		expect(body.sections.map((s) => s.key)).toEqual([
			"chatInbound",
			"defaults",
			"ai",
			"transcription",
			"webSearch",
			"projects",
		]);
		// All sections and their children should be section-type only (no fields)
		for (const section of body.sections) {
			expect(section.kind).toBe("section");
			for (const child of section.children ?? []) {
				expect(child.kind).toBe("section");
			}
		}
		// AI should have 4 sub-sections (openai, vercel, ollama, chutes)
		const ai = body.sections.find((s) => s.key === "ai");
		expect(ai?.children).toHaveLength(4);
		expect(ai?.children?.map((c) => c.key)).toContain("ai.openai");
	});

	it("GET /api/configure/sections/:sectionKey returns full section detail", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/configure/sections/ai.openai"),
			null,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			section: {
				label: string;
				kind: string;
				key: string;
				children: Array<{ label: string; kind: string; key: string }>;
			};
			values: Record<string, string>;
			integrationLabels: Record<string, string>;
		};
		expect(body.section.key).toBe("ai.openai");
		expect(body.section.label).toBe("OpenAI");
		expect(body.section.children).toHaveLength(1);
		expect(body.section.children[0].key).toBe("ai.openai.token");
		expect(body.section.children[0].kind).toBe("value");
		expect(typeof body.values["ai.openai.token"]).toBe("string");
	});

	it("GET /api/configure/sections/:sectionKey returns 404 for unknown section", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/configure/sections/nonexistent"),
			null,
		);
		expect(res.status).toBe(404);
	});

	it("serves AI provider icon assets", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/icons/ai/openai.png"),
			null,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/png");
		expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
	});

	it("handles POST /api/daemon/restart", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/daemon/restart", { method: "POST" }),
			null,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, restarting: true });
	});

	it("returns integration status for a discovered integration", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/integrations/slack/status"),
			null,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			name: string;
			displayName: string;
			connected: boolean;
			pluginPath: string | null;
			supportsSetup: boolean;
			health: { ok: boolean; details: string };
		};
		expect(body.name).toBe("slack");
		expect(body.displayName).toBe("Slack");
		expect(typeof body.connected).toBe("boolean");
		expect(
			body.pluginPath === null || typeof body.pluginPath === "string",
		).toBe(true);
		expect(typeof body.supportsSetup).toBe("boolean");
		expect(body.health).toMatchObject({
			ok: expect.any(Boolean),
			details: expect.any(String),
		});
	});

	it("returns 404 for an unknown integration status", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/integrations/unknown/status"),
			null,
		);
		expect(res.status).toBe(404);
	});

	it("handles disconnect for a non-connected integration", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/integrations/slack/disconnect", {
				method: "POST",
			}),
			null,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	it("returns setup guide for a discovered integration", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/integrations/slack/setup-guide"),
			null,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			ok: boolean;
			name: string;
			displayName: string;
			steps: Array<{ id: string; title: string }>;
		};
		expect(body.ok).toBe(true);
		expect(body.name).toBe("slack");
		expect(body.displayName).toBe("Slack");
		expect(body.steps.length).toBeGreaterThan(0);
		expect(body.steps.map((s) => s.id)).toContain("overview");
		expect(body.steps.map((s) => s.id)).toContain("credentials");
	}, 30000);

	it("returns 404 for an unknown integration setup guide", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/integrations/unknown/setup-guide"),
			null,
		);
		expect(res.status).toBe(404);
	});
});

describe("persona API", () => {
	let tempDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-persona-api-"));
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = tempDir;
	});

	afterEach(() => {
		if (previousTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("GET /api/ai/providers returns provider list with configured flags", async () => {
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
		// In a fresh temp dir with no credentials, providers should be unconfigured
		expect(openai?.configured).toBe(false);
	});

	it("GET /api/personas returns list with isDefault and isBuiltIn flags", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/personas"),
			null,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			personas: Array<{
				name: string;
				isDefault: boolean;
				isBuiltIn: boolean;
			}>;
		};
		expect(body.personas.length).toBeGreaterThan(0);
		const toby = body.personas.find((p) => p.name === "Toby");
		expect(toby).toBeDefined();
		expect(toby?.isBuiltIn).toBe(true);
	});

	it("GET /api/personas/:name returns full persona detail", async () => {
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
		expect(body.persona.promptMode).toMatch(/^(add|replace)$/);
	});

	it("GET /api/personas/:name returns 404 for unknown persona", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/personas/Nonexistent"),
			null,
		);
		expect(res.status).toBe(404);
	});

	it("create-persona accepts explicit fields", async () => {
		writeCredentials({ ai: { openai: { token: "sk-test" } } });
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/configure/actions/create-persona", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "TestPersona",
					instructions: "Be concise.",
					provider: "openai",
					model: "gpt-5-mini",
					promptMode: "add",
				}),
			}),
			null,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; personaName: string };
		expect(body.ok).toBe(true);
		expect(body.personaName).toBe("TestPersona");
	});

	it("create-persona rejects reserved name", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/configure/actions/create-persona", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Toby" }),
			}),
			null,
		);
		expect(res.status).toBe(400);
	});

	it("update-persona modifies an existing persona", async () => {
		writeCredentials({ ai: { openai: { token: "sk-test" } } });
		// First create a persona
		const createRes = await handleWebRequest(
			new Request("http://127.0.0.1/api/configure/actions/create-persona", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "UpdateTest",
					instructions: "Original",
					provider: "openai",
					model: "gpt-5-mini",
					promptMode: "add",
				}),
			}),
			null,
		);
		expect(createRes.status).toBe(200);

		// Now update it
		const updateRes = await handleWebRequest(
			new Request("http://127.0.0.1/api/configure/actions/update-persona", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					originalName: "UpdateTest",
					instructions: "Updated instructions",
					model: "gpt-5",
				}),
			}),
			null,
		);
		expect(updateRes.status).toBe(200);
		const updateBody = (await updateRes.json()) as {
			ok: boolean;
			personaName: string;
		};
		expect(updateBody.ok).toBe(true);
		expect(updateBody.personaName).toBe("UpdateTest");
	});

	it("update-persona supports rename", async () => {
		writeCredentials({ ai: { openai: { token: "sk-test" } } });
		// Create
		await handleWebRequest(
			new Request("http://127.0.0.1/api/configure/actions/create-persona", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "RenameMe" }),
			}),
			null,
		);

		// Rename
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/configure/actions/update-persona", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					originalName: "RenameMe",
					name: "Renamed",
				}),
			}),
			null,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; personaName: string };
		expect(body.personaName).toBe("Renamed");
	});

	it("update-persona updates provider and model for the built-in persona", async () => {
		writeConfig({
			integrations: {},
			personas: [],
			ai: { ollama: { baseUrl: "http://localhost:11434/v1" } },
		});
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/configure/actions/update-persona", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					originalName: "Toby",
					provider: "ollama",
					model: "llama3.2",
				}),
			}),
			null,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; personaName: string };
		expect(body).toEqual({ ok: true, personaName: "Toby" });
		const persona = readConfig().personas.find((p) => p.name === "Toby");
		expect(persona?.ai).toEqual({ provider: "ollama", model: "llama3.2" });
	});

	it("update-persona rejects locked built-in persona fields", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/configure/actions/update-persona", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					originalName: "Toby",
					instructions: "Hacked",
				}),
			}),
			null,
		);
		expect(res.status).toBe(400);
	});

	it("update-persona returns error for unknown persona", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/configure/actions/update-persona", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					originalName: "Ghost",
					instructions: "Boo",
				}),
			}),
			null,
		);
		expect(res.status).toBe(400);
	});
});
