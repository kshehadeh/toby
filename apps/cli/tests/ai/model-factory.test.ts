import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	buildAiGatewayAttributionHeaders,
	formatPersonaAiLabel,
	normalizeModelOnProviderChange,
	validatePersonaAi,
} from "@toby/core/ai/model-factory";
import type { Persona } from "@toby/core/config/index";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

let tempDir: string;
let previousTobyDir: string | undefined;

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-model-factory-"));
	previousTobyDir = process.env.TOBY_DIR;
	process.env.TOBY_DIR = tempDir;
});

afterEach(() => {
	if (previousTobyDir === undefined) {
		process.env.TOBY_DIR = undefined;
	} else {
		process.env.TOBY_DIR = previousTobyDir;
	}
	fs.rmSync(tempDir, { recursive: true, force: true });
});

function testPersona(ai: { provider: string; model: string }): Persona {
	return {
		name: "Test",
		instructions: "",
		promptMode: "add",
		ai,
	};
}

describe("validatePersonaAi", () => {
	it("accepts openai model ids without slashes", () => {
		expect(() =>
			validatePersonaAi(
				testPersona({ provider: "openai", model: "gpt-5-mini" }),
			),
		).not.toThrow();
	});

	it("rejects openai model ids with slashes", () => {
		expect(() =>
			validatePersonaAi(
				testPersona({ provider: "openai", model: "openai/gpt-5-mini" }),
			),
		).toThrow(/must not contain/);
	});

	it("accepts vercel gateway slugs", () => {
		expect(() =>
			validatePersonaAi(
				testPersona({
					provider: "vercel",
					model: "anthropic/claude-sonnet-4.6",
				}),
			),
		).not.toThrow();
	});

	it("rejects invalid vercel slugs", () => {
		expect(() =>
			validatePersonaAi(
				testPersona({ provider: "vercel", model: "gpt-5-mini" }),
			),
		).toThrow(/Invalid Vercel AI Gateway/);
	});

	it("accepts ollama model names with tags", () => {
		expect(() =>
			validatePersonaAi(
				testPersona({ provider: "ollama", model: "qwen2.5-coder:7b" }),
			),
		).not.toThrow();
	});

	it("rejects empty ollama model names", () => {
		expect(() =>
			validatePersonaAi(testPersona({ provider: "ollama", model: "   " })),
		).toThrow(/Ollama model name is required/);
	});
});

describe("normalizeModelOnProviderChange", () => {
	it("prefixes bare ids when switching to vercel", () => {
		expect(normalizeModelOnProviderChange("vercel", "gpt-5-mini")).toBe(
			"openai/gpt-5-mini",
		);
	});

	it("strips vendor prefix when switching to openai", () => {
		expect(normalizeModelOnProviderChange("openai", "openai/gpt-5-mini")).toBe(
			"gpt-5-mini",
		);
	});

	it("keeps valid gateway slugs when switching to vercel", () => {
		expect(
			normalizeModelOnProviderChange("vercel", "anthropic/claude-sonnet-4.6"),
		).toBe("anthropic/claude-sonnet-4.6");
	});

	it("strips vendor prefix when switching to ollama", () => {
		expect(normalizeModelOnProviderChange("ollama", "openai/gpt-5-mini")).toBe(
			"gpt-5-mini",
		);
	});

	it("keeps bare model names when switching to ollama", () => {
		expect(normalizeModelOnProviderChange("ollama", "llama3.2")).toBe(
			"llama3.2",
		);
	});
});

describe("buildAiGatewayAttributionHeaders", () => {
	const envKeys = [
		"TOBY_AI_GATEWAY_REFERER",
		"AI_GATEWAY_HTTP_REFERER",
		"TOBY_AI_GATEWAY_APP_TITLE",
		"AI_GATEWAY_X_TITLE",
	] as const;
	const previous: Partial<
		Record<(typeof envKeys)[number], string | undefined>
	> = {};

	beforeEach(() => {
		for (const key of envKeys) {
			previous[key] = process.env[key];
			delete process.env[key];
		}
	});

	afterEach(() => {
		for (const key of envKeys) {
			if (previous[key] === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = previous[key];
			}
		}
	});

	it("uses Toby defaults when env is unset", () => {
		expect(buildAiGatewayAttributionHeaders()).toEqual({
			"http-referer": "https://github.com/kshehadeh/toby",
			"x-title": "Toby",
		});
	});

	it("allows TOBY_AI_GATEWAY_* overrides", () => {
		process.env.TOBY_AI_GATEWAY_REFERER = "https://example.com/toby";
		process.env.TOBY_AI_GATEWAY_APP_TITLE = "My Toby";
		expect(buildAiGatewayAttributionHeaders()).toEqual({
			"http-referer": "https://example.com/toby",
			"x-title": "My Toby",
		});
	});
});

describe("formatPersonaAiLabel", () => {
	it("shows provider/model for openai", () => {
		expect(
			formatPersonaAiLabel(
				testPersona({ provider: "openai", model: "gpt-5-mini" }),
			),
		).toBe("openai/gpt-5-mini");
	});

	it("shows gateway slug only for vercel", () => {
		expect(
			formatPersonaAiLabel(
				testPersona({ provider: "vercel", model: "openai/gpt-5-mini" }),
			),
		).toBe("openai/gpt-5-mini");
	});

	it("shows provider/model for ollama", () => {
		expect(
			formatPersonaAiLabel(
				testPersona({ provider: "ollama", model: "llama3.2" }),
			),
		).toBe("ollama/llama3.2");
	});
});
