import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	clearDefaultPersona,
	ensurePersonaImagesDir,
	resolvePersonaImagePath,
	setDefaultPersona,
} from "@toby/core/config/index";
import {
	BUILTIN_PERSONAS,
	DEFAULT_CHAT_PERSONA,
	DEFAULT_TOBY_INSTRUCTIONS,
	MAILMAN_INSTRUCTIONS,
	MAILMAN_PERSONA,
	getBuiltInPersona,
	isBuiltInPersonaName,
	listPersonas,
	personaImageApiPath,
	removeUserPersonaImage,
	resolveDefaultPersona,
	resolvePersona,
	resolvePersonaImageFile,
	withBuiltInPersonaDefaults,
} from "@toby/core/personas/index";

let tempDir: string;
let previousTobyDir: string | undefined;

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-personas-"));
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

describe("default Toby instructions", () => {
	it("ships a non-empty productivity prompt with the core guardrails", () => {
		expect(DEFAULT_CHAT_PERSONA.instructions).toBe(DEFAULT_TOBY_INSTRUCTIONS);
		expect(DEFAULT_TOBY_INSTRUCTIONS.length).toBeGreaterThan(200);
		expect(DEFAULT_TOBY_INSTRUCTIONS).toContain(
			"You are Toby, a personal productivity assistant",
		);
		expect(DEFAULT_TOBY_INSTRUCTIONS).toContain("## Focus");
		expect(DEFAULT_TOBY_INSTRUCTIONS).toContain("## Grounding");
		expect(DEFAULT_TOBY_INSTRUCTIONS).toContain("## Missing context");
		expect(DEFAULT_TOBY_INSTRUCTIONS).toContain("## Productivity");
		expect(DEFAULT_TOBY_INSTRUCTIONS).toMatch(/Do not invent/i);
		expect(DEFAULT_TOBY_INSTRUCTIONS).toMatch(/ask one focused question/i);
		expect(DEFAULT_TOBY_INSTRUCTIONS).toContain("## Categories");
		expect(DEFAULT_TOBY_INSTRUCTIONS).toContain("- News:");
		expect(DEFAULT_TOBY_INSTRUCTIONS).toContain("- Ads:");
		expect(DEFAULT_TOBY_INSTRUCTIONS).toContain("- Personal:");
		expect(DEFAULT_TOBY_INSTRUCTIONS).toContain("- Career:");
		expect(DEFAULT_TOBY_INSTRUCTIONS).toContain("- Creative:");
	});
});

describe("Mailman instructions", () => {
	it("ships inbox triage priorities and email categories", () => {
		expect(MAILMAN_PERSONA.instructions).toBe(MAILMAN_INSTRUCTIONS);
		expect(MAILMAN_INSTRUCTIONS).toContain("You are Mailman");
		expect(MAILMAN_INSTRUCTIONS).toContain("## Triage");
		expect(MAILMAN_INSTRUCTIONS).toContain("Needs attention");
		expect(MAILMAN_INSTRUCTIONS).toContain("Worth noting");
		expect(MAILMAN_INSTRUCTIONS).toContain("Ignore");
		expect(MAILMAN_INSTRUCTIONS).toContain("- Personal:");
		expect(MAILMAN_INSTRUCTIONS).toContain("- Work:");
		expect(MAILMAN_INSTRUCTIONS).toContain("- Financial:");
		expect(MAILMAN_INSTRUCTIONS).toContain("- Home:");
		expect(MAILMAN_INSTRUCTIONS).toContain("- Travel:");
		expect(MAILMAN_INSTRUCTIONS).toContain("- Accounts:");
		expect(MAILMAN_INSTRUCTIONS).toContain("- Promotions:");
	});
});

describe("built-in persona registry", () => {
	it("treats Toby and Mailman as reserved built-ins", () => {
		expect(isBuiltInPersonaName("Toby")).toBe(true);
		expect(isBuiltInPersonaName("Mailman")).toBe(true);
		expect(isBuiltInPersonaName("Planner")).toBe(false);
		expect(getBuiltInPersona("Mailman")).toEqual(MAILMAN_PERSONA);
		expect(BUILTIN_PERSONAS.map((p) => p.name)).toEqual(["Toby", "Mailman"]);
		expect(DEFAULT_CHAT_PERSONA.imagePath).toBe("toby.png");
		expect(MAILMAN_PERSONA.imagePath).toBe("mailman.png");
	});
});

describe("personas", () => {
	it("resolves the built-in default chat persona", () => {
		expect(resolvePersona("Toby")).toEqual(DEFAULT_CHAT_PERSONA);
	});

	it("resolves the built-in Mailman persona", () => {
		expect(resolvePersona("Mailman")).toEqual(MAILMAN_PERSONA);
	});

	it("includes every built-in persona in the persona list", () => {
		expect(listPersonas()).toEqual([...BUILTIN_PERSONAS]);
	});

	it("keeps built-in instructions and promptMode when config only changes AI settings", () => {
		const override = {
			name: "Toby",
			instructions: "Use my local defaults.",
			promptMode: "replace" as const,
			ai: { provider: "openai", model: "gpt-5.1" },
			imagePath: "toby.png",
		};
		fs.writeFileSync(
			path.join(tempDir, "config.json"),
			JSON.stringify({ integrations: {}, personas: [override] }),
		);

		const expectedToby = {
			...override,
			instructions: DEFAULT_CHAT_PERSONA.instructions,
			promptMode: DEFAULT_CHAT_PERSONA.promptMode,
		};
		expect(resolvePersona("Toby")).toEqual(expectedToby);
		expect(listPersonas()[0]).toEqual(expectedToby);
		expect(listPersonas()[1]).toEqual({
			...MAILMAN_PERSONA,
			ai: override.ai,
		});
	});

	it("hydrates a persisted Mailman copy without adopting stale instructions", () => {
		const override = {
			name: "Mailman",
			instructions: "Hack the mail.",
			promptMode: "replace" as const,
			ai: { provider: "openai", model: "gpt-5.1" },
		};
		fs.writeFileSync(
			path.join(tempDir, "config.json"),
			JSON.stringify({ integrations: {}, personas: [override] }),
		);

		expect(resolvePersona("Mailman")).toEqual({
			...override,
			instructions: MAILMAN_PERSONA.instructions,
			promptMode: MAILMAN_PERSONA.promptMode,
			imagePath: MAILMAN_PERSONA.imagePath,
		});
	});

	it("fills a missing built-in imagePath and keeps a custom upload", () => {
		expect(
			withBuiltInPersonaDefaults({
				name: "Mailman",
				instructions: "stale",
				promptMode: "replace",
				ai: { provider: "openai", model: "gpt-5.1" },
			}).imagePath,
		).toBe("mailman.png");
		expect(
			withBuiltInPersonaDefaults({
				name: "Toby",
				instructions: "stale",
				promptMode: "add",
				ai: { provider: "openai", model: "gpt-5.1" },
				imagePath: "Toby-custom.png",
			}).imagePath,
		).toBe("Toby-custom.png");
	});

	it("does not rewrite instructions for custom personas", () => {
		const custom = {
			name: "Planner",
			instructions: "Focus on calendars.",
			promptMode: "replace" as const,
			ai: { provider: "openai", model: "gpt-5.1" },
		};
		expect(withBuiltInPersonaDefaults(custom)).toEqual(custom);
	});

	it("lists custom personas after the built-ins", () => {
		const custom = {
			name: "Planner",
			instructions: "Focus on calendars.",
			promptMode: "add" as const,
			ai: { provider: "openai", model: "gpt-5.1" },
		};
		fs.writeFileSync(
			path.join(tempDir, "config.json"),
			JSON.stringify({ integrations: {}, personas: [custom] }),
		);

		expect(listPersonas()).toEqual([...BUILTIN_PERSONAS, custom]);
	});

	describe("resolveDefaultPersona", () => {
		it("returns the built-in default when no default is configured", () => {
			expect(resolveDefaultPersona()).toEqual(DEFAULT_CHAT_PERSONA);
		});

		it("returns the configured default persona", () => {
			const myPersona = {
				name: "my-persona",
				instructions: "Be concise.",
				promptMode: "add" as const,
				ai: { provider: "openai", model: "gpt-5.1" },
			};
			fs.writeFileSync(
				path.join(tempDir, "config.json"),
				JSON.stringify({
					integrations: {},
					personas: [myPersona],
					defaultPersona: "my-persona",
				}),
			);

			expect(resolveDefaultPersona()).toEqual(myPersona);
		});

		it("can use Mailman as the configured default", () => {
			fs.writeFileSync(
				path.join(tempDir, "config.json"),
				JSON.stringify({
					integrations: {},
					personas: [],
					defaultPersona: "Mailman",
				}),
			);

			expect(resolveDefaultPersona()).toEqual(MAILMAN_PERSONA);
		});

		it("falls back to built-in when configured default does not exist", () => {
			fs.writeFileSync(
				path.join(tempDir, "config.json"),
				JSON.stringify({
					integrations: {},
					personas: [],
					defaultPersona: "nonexistent",
				}),
			);

			expect(resolveDefaultPersona()).toEqual(DEFAULT_CHAT_PERSONA);
		});

		it("respects setDefaultPersona and clearDefaultPersona", () => {
			const myPersona = {
				name: "my-persona",
				instructions: "Be concise.",
				promptMode: "add" as const,
				ai: { provider: "openai", model: "gpt-5.1" },
			};
			fs.writeFileSync(
				path.join(tempDir, "config.json"),
				JSON.stringify({ integrations: {}, personas: [myPersona] }),
			);

			setDefaultPersona("my-persona");
			expect(resolveDefaultPersona()).toEqual(myPersona);

			clearDefaultPersona();
			expect(resolveDefaultPersona()).toEqual(DEFAULT_CHAT_PERSONA);
		});
	});

	describe("built-in persona images", () => {
		it("resolves bundled portraits and prefers a user override", () => {
			const mailman = resolvePersonaImageFile("mailman.png");
			const toby = resolvePersonaImageFile("toby.png");
			const fallback = resolvePersonaImageFile("default.png");
			expect(mailman).toBeTruthy();
			expect(toby).toBeTruthy();
			expect(fallback).toBe(toby);
			expect(mailman?.endsWith(`${path.sep}mailman.png`)).toBe(true);
			expect(fs.existsSync(mailman as string)).toBe(true);

			ensurePersonaImagesDir();
			const override = resolvePersonaImagePath("mailman.png");
			fs.writeFileSync(override, "user-upload");
			expect(resolvePersonaImageFile("mailman.png")).toBe(override);

			removeUserPersonaImage("mailman.png");
			expect(fs.existsSync(override)).toBe(false);
			expect(resolvePersonaImageFile("mailman.png")).toBe(mailman);
		});

		it("maps persona image API paths", () => {
			expect(personaImageApiPath("mailman.png")).toBe(
				"/api/personas/image/mailman.png",
			);
			expect(personaImageApiPath(undefined)).toBe(
				"/api/personas/image/default.png",
			);
		});
	});
});
