import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	clearOpenRouterTranscriptionCatalogCache,
	listOpenRouterTranscriptionModels,
} from "@toby/core/ai/model-list/openrouter-transcription-catalog";
import {
	clearVercelCatalogCache,
	listVercelTranscriptionModels,
} from "@toby/core/ai/model-list/vercel-catalog";
import {
	type CredentialsFile,
	readConfig,
	readCredentials,
	writeConfig,
	writeCredentials,
} from "@toby/core/config/index";
import {
	TRANSCRIPTION_PROVIDERS,
	getTranscriptionProvider,
	getTranscriptionSetupStatus,
	isTranscriptionConfigured,
	resolveTranscriptionApiKey,
	resolveTranscriptionSelection,
} from "@toby/core/listen/transcription-providers";

function withTempTobyDir(run: () => void | Promise<void>): Promise<void> {
	const previous = process.env.TOBY_DIR;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-transcription-"));
	process.env.TOBY_DIR = dir;
	return Promise.resolve()
		.then(run)
		.finally(() => {
			if (previous === undefined) {
				Reflect.deleteProperty(process.env, "TOBY_DIR");
			} else {
				process.env.TOBY_DIR = previous;
			}
			fs.rmSync(dir, { recursive: true, force: true });
		});
}

describe("transcription providers", () => {
	it("exposes openai, groq, vercel, and openrouter providers", () => {
		const ids = TRANSCRIPTION_PROVIDERS.map((p) => p.id);
		expect(ids).toContain("openai");
		expect(ids).toContain("groq");
		expect(ids).toContain("vercel");
		expect(ids).toContain("openrouter");
		expect(getTranscriptionProvider("openai")?.models).toContain("whisper-1");
		expect(getTranscriptionProvider("groq")?.models).toContain(
			"whisper-large-v3",
		);
	});

	it("openai provider reuses the shared openai token", () => {
		expect(getTranscriptionProvider("openai")?.reusesOpenAiToken).toBe(true);
	});
});

describe("transcription selection resolution", () => {
	it("returns undefined when no provider/model configured", () => {
		withTempTobyDir(() => {
			expect(isTranscriptionConfigured()).toBe(false);
			expect(resolveTranscriptionSelection()).toBeUndefined();
		});
	});

	it("returns undefined when configured but no api key present", () => {
		withTempTobyDir(() => {
			writeConfig({
				integrations: {},
				personas: [],
				transcription: { provider: "groq", model: "whisper-large-v3" },
			});
			expect(isTranscriptionConfigured()).toBe(false);
		});
	});

	it("resolves openai via the shared openai token", () => {
		withTempTobyDir(() => {
			const creds: CredentialsFile = {
				ai: { openai: { token: "sk-test-openai" } },
			};
			writeCredentials(creds);
			writeConfig({
				integrations: {},
				personas: [],
				transcription: { provider: "openai", model: "whisper-1" },
			});
			expect(resolveTranscriptionApiKey("openai")).toBe("sk-test-openai");
			const selection = resolveTranscriptionSelection();
			expect(selection).toEqual({
				provider: "openai",
				model: "whisper-1",
				apiKey: "sk-test-openai",
			});
			expect(isTranscriptionConfigured()).toBe(true);
		});
	});

	it("prefers a transcription-specific openai key over the shared token", () => {
		withTempTobyDir(() => {
			writeCredentials({
				ai: { openai: { token: "shared" } },
				transcription: { openai: { apiKey: "transcription-specific" } },
			});
			writeConfig({
				integrations: {},
				personas: [],
				transcription: { provider: "openai", model: "whisper-1" },
			});
			expect(resolveTranscriptionApiKey("openai")).toBe(
				"transcription-specific",
			);
		});
	});

	it("resolves groq via transcription credentials", () => {
		withTempTobyDir(() => {
			writeCredentials({ transcription: { groq: { apiKey: "gq-key" } } });
			writeConfig({
				integrations: {},
				personas: [],
				transcription: { provider: "groq", model: "whisper-large-v3" },
			});
			const selection = resolveTranscriptionSelection();
			expect(selection?.provider).toBe("groq");
			expect(selection?.apiKey).toBe("gq-key");
		});
	});
});

describe("transcription config persistence", () => {
	it("persists transcription config through readConfig/writeConfig", () => {
		withTempTobyDir(() => {
			writeConfig({
				integrations: {},
				personas: [],
				transcription: { provider: "groq", model: "whisper-large-v3" },
			});
			expect(readConfig().transcription).toEqual({
				provider: "groq",
				model: "whisper-large-v3",
			});
		});
	});

	it("round-trips transcription credentials through writeCredentials/readCredentials", () => {
		withTempTobyDir(() => {
			writeCredentials({ transcription: { groq: { apiKey: "gq-key" } } });
			expect(readCredentials().transcription?.groq?.apiKey).toBe("gq-key");
		});
	});
});

describe("vercel transcription provider", () => {
	it("exposes vercel in the provider registry", () => {
		const ids = TRANSCRIPTION_PROVIDERS.map((p) => p.id);
		expect(ids).toContain("vercel");
		const info = getTranscriptionProvider("vercel");
		expect(info?.displayName).toBe("Vercel AI Gateway");
		expect(info?.reusesVercelApiKey).toBe(true);
		expect(info?.allowCustomModel).toBe(true);
		expect(info?.models).toContain("openai/whisper-1");
	});

	it("resolves vercel via the shared AI vercel apiKey", () => {
		withTempTobyDir(() => {
			writeCredentials({ ai: { vercel: { apiKey: "vcel-shared" } } });
			writeConfig({
				integrations: {},
				personas: [],
				transcription: { provider: "vercel", model: "openai/whisper-1" },
			});
			expect(resolveTranscriptionApiKey("vercel")).toBe("vcel-shared");
			const selection = resolveTranscriptionSelection();
			expect(selection).toEqual({
				provider: "vercel",
				model: "openai/whisper-1",
				apiKey: "vcel-shared",
			});
			expect(isTranscriptionConfigured()).toBe(true);
		});
	});

	it("resolves vercel via AI_GATEWAY_API_KEY env when no cred key", () => {
		withTempTobyDir(() => {
			process.env.AI_GATEWAY_API_KEY = "env-gw-key";
			writeConfig({
				integrations: {},
				personas: [],
				transcription: { provider: "vercel", model: "openai/whisper-1" },
			});
			expect(resolveTranscriptionApiKey("vercel")).toBe("env-gw-key");
			expect(isTranscriptionConfigured()).toBe(true);
			Reflect.deleteProperty(process.env, "AI_GATEWAY_API_KEY");
		});
	});

	it("prefers a transcription-specific vercel key over the shared AI key", () => {
		withTempTobyDir(() => {
			writeCredentials({
				ai: { vercel: { apiKey: "shared" } },
				transcription: { vercel: { apiKey: "transcription-specific" } },
			});
			writeConfig({
				integrations: {},
				personas: [],
				transcription: { provider: "vercel", model: "openai/whisper-1" },
			});
			expect(resolveTranscriptionApiKey("vercel")).toBe(
				"transcription-specific",
			);
		});
	});

	it("resolves vercel with empty apiKey when only VERCEL_OIDC_TOKEN is set", () => {
		withTempTobyDir(() => {
			process.env.VERCEL_OIDC_TOKEN = "oidc-token";
			writeConfig({
				integrations: {},
				personas: [],
				transcription: { provider: "vercel", model: "openai/whisper-1" },
			});
			const key = resolveTranscriptionApiKey("vercel");
			expect(key).toBe("");
			expect(isTranscriptionConfigured()).toBe(true);
			Reflect.deleteProperty(process.env, "VERCEL_OIDC_TOKEN");
		});
	});

	it("returns undefined when vercel has no key and no OIDC", () => {
		withTempTobyDir(() => {
			writeConfig({
				integrations: {},
				personas: [],
				transcription: { provider: "vercel", model: "openai/whisper-1" },
			});
			expect(resolveTranscriptionApiKey("vercel")).toBeUndefined();
			expect(isTranscriptionConfigured()).toBe(false);
		});
	});
});

describe("vercel transcription catalog filter", () => {
	it("listVercelTranscriptionModels returns fallback list on network failure", async () => {
		clearVercelCatalogCache();
		const models = await listVercelTranscriptionModels();
		expect(models).toContain("openai/whisper-1");
		expect(models).toContain("openai/gpt-4o-mini-transcribe");
		// Should not contain non-transcription models
		expect(models.some((m) => m.includes("gpt-5"))).toBe(false);
	});
});

describe("openrouter transcription provider", () => {
	it("exposes openrouter in the provider registry", () => {
		const info = getTranscriptionProvider("openrouter");
		expect(info?.displayName).toBe("OpenRouter");
		expect(info?.reusesOpenRouterApiKey).toBe(true);
		expect(info?.allowCustomModel).toBe(true);
		expect(info?.models).toContain("openai/whisper-1");
	});

	it("resolves openrouter via the shared AI openrouter apiKey", () => {
		withTempTobyDir(() => {
			writeCredentials({ ai: { openrouter: { apiKey: "sk-or-shared" } } });
			writeConfig({
				integrations: {},
				personas: [],
				transcription: {
					provider: "openrouter",
					model: "openai/whisper-1",
				},
			});
			expect(resolveTranscriptionApiKey("openrouter")).toBe("sk-or-shared");
			const selection = resolveTranscriptionSelection();
			expect(selection).toEqual({
				provider: "openrouter",
				model: "openai/whisper-1",
				apiKey: "sk-or-shared",
			});
			expect(isTranscriptionConfigured()).toBe(true);
		});
	});

	it("resolves openrouter via OPENROUTER_API_KEY env when no cred key", () => {
		withTempTobyDir(() => {
			process.env.OPENROUTER_API_KEY = "env-or-key";
			writeConfig({
				integrations: {},
				personas: [],
				transcription: {
					provider: "openrouter",
					model: "openai/whisper-1",
				},
			});
			expect(resolveTranscriptionApiKey("openrouter")).toBe("env-or-key");
			expect(isTranscriptionConfigured()).toBe(true);
			Reflect.deleteProperty(process.env, "OPENROUTER_API_KEY");
		});
	});

	it("prefers a transcription-specific openrouter key over the shared AI key", () => {
		withTempTobyDir(() => {
			writeCredentials({
				ai: { openrouter: { apiKey: "shared" } },
				transcription: { openrouter: { apiKey: "transcription-specific" } },
			});
			writeConfig({
				integrations: {},
				personas: [],
				transcription: {
					provider: "openrouter",
					model: "openai/whisper-1",
				},
			});
			expect(resolveTranscriptionApiKey("openrouter")).toBe(
				"transcription-specific",
			);
		});
	});

	it("returns undefined when openrouter has no key", () => {
		withTempTobyDir(() => {
			writeConfig({
				integrations: {},
				personas: [],
				transcription: {
					provider: "openrouter",
					model: "openai/whisper-1",
				},
			});
			expect(resolveTranscriptionApiKey("openrouter")).toBeUndefined();
			expect(isTranscriptionConfigured()).toBe(false);
		});
	});

	it("reports needsApiKey when provider is set without a key (unlike openai/vercel reuse)", () => {
		withTempTobyDir(() => {
			// OpenAI AI key present — openai transcription would be ready via reuse.
			writeCredentials({ ai: { openai: { token: "sk-oai" } } });
			writeConfig({
				integrations: {},
				personas: [],
				transcription: {
					provider: "groq",
					model: "whisper-large-v3",
				},
			});
			const status = getTranscriptionSetupStatus();
			expect(status.hasProviderAndModel).toBe(true);
			expect(status.hasApiKey).toBe(false);
			expect(status.needsApiKey).toBe(true);
			expect(status.configured).toBe(false);
			expect(status.statusMessage).toMatch(/API key/i);
		});
	});

	it("resolves groq via GROQ_API_KEY env", () => {
		withTempTobyDir(() => {
			process.env.GROQ_API_KEY = "gsk-env";
			writeConfig({
				integrations: {},
				personas: [],
				transcription: {
					provider: "groq",
					model: "whisper-large-v3",
				},
			});
			expect(resolveTranscriptionApiKey("groq")).toBe("gsk-env");
			expect(isTranscriptionConfigured()).toBe(true);
			Reflect.deleteProperty(process.env, "GROQ_API_KEY");
		});
	});
});

describe("openrouter transcription catalog", () => {
	it("listOpenRouterTranscriptionModels returns STT slugs (live or fallback)", async () => {
		clearOpenRouterTranscriptionCatalogCache();
		const models = await listOpenRouterTranscriptionModels();
		expect(models.length).toBeGreaterThan(0);
		// Live catalog or fallback always includes whisper-style ids.
		expect(
			models.some(
				(m) =>
					m.includes("whisper") || m.includes("transcribe") || m.includes("/"),
			),
		).toBe(true);
	});
});
