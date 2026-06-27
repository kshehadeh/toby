import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCredentials } from "@toby/core/config/index";
import {
	applyConfigureValuesPatch,
	collectSecretConfigureKeys,
	rebuildCustomModels,
	redactConfigureValues,
	seedConfigureValues,
} from "@toby/core/configure/persistence";
import { handleWebRequest } from "@toby/core/web/routes";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function withTempTobyDir(run: () => void): void {
	const previous = process.env.TOBY_DIR;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-secret-test-"));
	process.env.TOBY_DIR = dir;
	try {
		run();
	} finally {
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
		const values = seedConfigureValues();
		expect(typeof values["chatInbound.enabled"]).toBe("string");
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

	it("includes integration display names for configure selects", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/configure/tree"),
			null,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			integrationLabels: Record<string, string>;
		};
		expect(body.integrationLabels.gmail).toBe("Gmail");
		expect(body.integrationLabels.slack).toBe("Slack");
		expect(body.integrationLabels["(none)"]).toBe("None");
	});

	it("GET /api/configure/sections returns 4 lightweight section structures", async () => {
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
		expect(body.sections).toHaveLength(4);
		expect(body.sections.map((s) => s.key)).toEqual([
			"chatInbound",
			"defaults",
			"ai",
			"projects",
		]);
		// All sections and their children should be section-type only (no fields)
		for (const section of body.sections) {
			expect(section.kind).toBe("section");
			for (const child of section.children ?? []) {
				expect(child.kind).toBe("section");
			}
		}
		// AI should have 3 sub-sections
		const ai = body.sections.find((s) => s.key === "ai");
		expect(ai?.children).toHaveLength(3);
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
			new Request("http://127.0.0.1/api/integrations/gmail/status"),
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
		expect(body.name).toBe("gmail");
		expect(body.displayName).toBe("Gmail");
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
			new Request("http://127.0.0.1/api/integrations/gmail/disconnect", {
				method: "POST",
			}),
			null,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	it("returns setup guide for a discovered integration", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/integrations/gmail/setup-guide"),
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
		expect(body.name).toBe("gmail");
		expect(body.displayName).toBe("Gmail");
		expect(body.steps.length).toBeGreaterThan(0);
		expect(body.steps.map((s) => s.id)).toContain("overview");
		expect(body.steps.map((s) => s.id)).toContain("credentials");
	});

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

	it("GET /api/ai/providers returns provider list", async () => {
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
			}>;
		};
		expect(body.providers.length).toBeGreaterThan(0);
		const openai = body.providers.find((p) => p.id === "openai");
		expect(openai).toBeDefined();
		expect(openai?.displayName).toBe("OpenAI");
		expect(openai?.models.length).toBeGreaterThan(0);
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

	it("update-persona rejects editing built-in persona", async () => {
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
