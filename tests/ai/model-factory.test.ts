import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	formatPersonaAiLabel,
	normalizeModelOnProviderChange,
	validatePersonaAi,
} from "../../src/ai/model-factory";
import type { Persona } from "../../src/config/index";

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
});
