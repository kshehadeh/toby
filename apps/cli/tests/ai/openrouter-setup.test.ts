import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	getProviderSetupAdapter,
	hasProviderSetupAdapter,
} from "@toby/core/ai/provider-setup";
import {
	OPENROUTER_DEFAULT_SETUP_MODEL,
	openRouterProviderSetupAdapter,
	validateOpenRouterApiKey,
} from "@toby/core/ai/provider-setup/adapters/openrouter";
import {
	readConfig,
	readCredentials,
	writeConfig,
	writeCredentials,
} from "@toby/core/config/index";
import { DEFAULT_CHAT_PERSONA } from "@toby/core/personas/index";

describe("provider-setup (openrouter adapter)", () => {
	let tempDir: string;
	let previousTobyDir: string | undefined;
	let previousKeyBackend: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-openrouter-setup-"));
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

	it("registers openrouter under the generic setup registry", () => {
		expect(hasProviderSetupAdapter("openrouter")).toBe(true);
		expect(getProviderSetupAdapter("openrouter")?.providerId).toBe(
			"openrouter",
		);
	});

	it("rejects empty API keys without calling the network", async () => {
		const result = await validateOpenRouterApiKey("  ", {
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
		const result = await validateOpenRouterApiKey("bad-key", {
			fetchImpl: async () =>
				new Response(
					JSON.stringify({ error: { message: "Unauthorized", code: 401 } }),
					{
						status: 401,
						headers: { "Content-Type": "application/json" },
					},
				),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.status).toBe(401);
			expect(result.error).toMatch(/rejected/i);
		}
	});

	it("returns limit remaining on success", async () => {
		const result = await validateOpenRouterApiKey("sk-or-test", {
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						data: {
							label: "Toby",
							usage: 1.25,
							limit_remaining: 98.75,
							is_free_tier: false,
						},
					}),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					},
				),
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.remaining).toBe(98.75);
			expect(result.totalSpent).toBe(1.25);
			expect(result.label).toBe("Toby");
		}
	});

	it("exposes a guide with open-ended fields schema", async () => {
		const guide = await openRouterProviderSetupAdapter.getGuide();
		expect(guide.providerId).toBe("openrouter");
		expect(guide.fields.some((f) => f.key === "apiKey" && f.secret)).toBe(true);
		expect(guide.steps.length).toBeGreaterThanOrEqual(3);
		expect(guide.defaultModel).toBe(OPENROUTER_DEFAULT_SETUP_MODEL);
	});

	it("persists the key and switches the Toby persona to openrouter", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					data: { usage: 0, limit_remaining: 10, label: "sk-or-…" },
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			)) as typeof fetch;
		try {
			const applied = await openRouterProviderSetupAdapter.setup({
				fields: { apiKey: "sk-or-saved" },
			});
			expect(applied.ok).toBe(true);
			if (!applied.ok) return;
			expect(applied.providerId).toBe("openrouter");
			expect(applied.model).toBe(OPENROUTER_DEFAULT_SETUP_MODEL);
			expect(applied.personaName).toBe(DEFAULT_CHAT_PERSONA.name);

			const creds = readCredentials();
			expect(creds.ai?.openrouter?.apiKey).toBe("sk-or-saved");

			const cfg = readConfig();
			const toby = cfg.personas.find(
				(p) => p.name === DEFAULT_CHAT_PERSONA.name,
			);
			expect(toby?.ai.provider).toBe("openrouter");
			expect(toby?.ai.model).toBe(OPENROUTER_DEFAULT_SETUP_MODEL);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
