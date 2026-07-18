import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	getProviderSetupAdapter,
	hasProviderSetupAdapter,
} from "@toby/core/ai/provider-setup";
import {
	VERCEL_AI_GATEWAY_DEFAULT_MODEL,
	validateVercelAIGatewayApiKey,
	vercelProviderSetupAdapter,
} from "@toby/core/ai/provider-setup/adapters/vercel";
import {
	readConfig,
	readCredentials,
	writeConfig,
	writeCredentials,
} from "@toby/core/config/index";
import { DEFAULT_CHAT_PERSONA } from "@toby/core/personas/index";

describe("provider-setup (vercel adapter)", () => {
	let tempDir: string;
	let previousTobyDir: string | undefined;
	let previousKeyBackend: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-vercel-setup-"));
		previousTobyDir = process.env.TOBY_DIR;
		previousKeyBackend = process.env.TOBY_CREDENTIALS_KEY_BACKEND;
		process.env.TOBY_DIR = tempDir;
		process.env.TOBY_CREDENTIALS_KEY_BACKEND = "plaintext";
		writeConfig({ personas: [] });
		writeCredentials({});
	});

	afterEach(() => {
		if (previousTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		if (previousKeyBackend === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_CREDENTIALS_KEY_BACKEND");
		} else {
			process.env.TOBY_CREDENTIALS_KEY_BACKEND = previousKeyBackend;
		}
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("registers vercel under the generic setup registry", () => {
		expect(hasProviderSetupAdapter("vercel")).toBe(true);
		expect(hasProviderSetupAdapter("openai")).toBe(false);
		expect(getProviderSetupAdapter("vercel")?.providerId).toBe("vercel");
	});

	it("rejects empty API keys without calling the network", async () => {
		const result = await validateVercelAIGatewayApiKey("  ", {
			fetchImpl: async () => {
				throw new Error("should not fetch");
			},
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toMatch(/required/i);
		}
	});

	it("treats 401 as invalid key", async () => {
		const result = await validateVercelAIGatewayApiKey("bad-key", {
			fetchImpl: async () =>
				new Response(JSON.stringify({ error: { message: "Unauthorized" } }), {
					status: 401,
					headers: { "Content-Type": "application/json" },
				}),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.status).toBe(401);
			expect(result.error).toMatch(/rejected/i);
		}
	});

	it("returns remaining balance on success", async () => {
		const result = await validateVercelAIGatewayApiKey("vck_test", {
			fetchImpl: async () =>
				new Response(JSON.stringify({ balance: "4.50", total_used: "0.50" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.remaining).toBe(4.5);
			expect(result.totalSpent).toBe(0.5);
		}
	});

	it("exposes a guide with open-ended fields schema", async () => {
		const guide = await vercelProviderSetupAdapter.getGuide();
		expect(guide.providerId).toBe("vercel");
		expect(guide.fields.some((f) => f.key === "apiKey" && f.secret)).toBe(true);
		expect(guide.steps.length).toBeGreaterThanOrEqual(3);
		expect(guide.defaultModel).toBe(VERCEL_AI_GATEWAY_DEFAULT_MODEL);
	});

	it("persists the key and switches the Toby persona to vercel", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ balance: "5", total_used: "0" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			})) as typeof fetch;
		try {
			const applied = await vercelProviderSetupAdapter.setup({
				fields: { apiKey: "vck_saved" },
			});
			expect(applied.ok).toBe(true);
			if (!applied.ok) return;
			expect(applied.providerId).toBe("vercel");
			expect(applied.model).toBe(VERCEL_AI_GATEWAY_DEFAULT_MODEL);
			expect(applied.personaName).toBe(DEFAULT_CHAT_PERSONA.name);

			const creds = readCredentials();
			expect(creds.ai?.vercel?.apiKey).toBe("vck_saved");

			const cfg = readConfig();
			const toby = cfg.personas.find(
				(p) => p.name === DEFAULT_CHAT_PERSONA.name,
			);
			expect(toby?.ai.provider).toBe("vercel");
			expect(toby?.ai.model).toBe(VERCEL_AI_GATEWAY_DEFAULT_MODEL);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("honors a custom model slug", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ balance: "1", total_used: "0" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			})) as typeof fetch;
		try {
			const applied = await vercelProviderSetupAdapter.setup({
				fields: { apiKey: "vck_saved" },
				model: "anthropic/claude-haiku-4.5",
			});
			expect(applied.ok).toBe(true);
			if (!applied.ok) return;
			expect(applied.model).toBe("anthropic/claude-haiku-4.5");
			const cfg = readConfig();
			const toby = cfg.personas.find(
				(p) => p.name === DEFAULT_CHAT_PERSONA.name,
			);
			expect(toby?.ai.model).toBe("anthropic/claude-haiku-4.5");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
