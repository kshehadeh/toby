import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	readConfig,
	writeConfig,
	writeCredentials,
} from "@toby/core/config/index";
import {
	applyConfigureValuesPatch,
	normalizeTranscriptionConfigureValues,
} from "@toby/core/configure/persistence";

describe("transcription configure patch", () => {
	let tempDir: string;
	let previousTobyDir: string | undefined;
	let previousKeyBackend: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-tx-patch-"));
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

	it("normalize fills default model when only provider is set", () => {
		const values: Record<string, string> = {
			"transcription.provider": "openrouter",
		};
		normalizeTranscriptionConfigureValues(values, {
			providerJustChanged: true,
		});
		expect(values["transcription.provider"]).toBe("openrouter");
		expect(values["transcription.model"]?.length).toBeGreaterThan(0);
		expect(values["transcription.model"]).toContain("/");
	});

	it("normalize fills default provider when only model is set", () => {
		const values: Record<string, string> = {
			"transcription.model": "whisper-1",
		};
		normalizeTranscriptionConfigureValues(values);
		expect(values["transcription.provider"]).toBeTruthy();
		expect(values["transcription.model"]).toBe("whisper-1");
	});

	it("saves openrouter when only provider is patched (autosave-style)", () => {
		applyConfigureValuesPatch({ "transcription.provider": "openrouter" });
		const cfg = readConfig();
		expect(cfg.transcription?.provider).toBe("openrouter");
		expect(cfg.transcription?.model?.length).toBeGreaterThan(0);
	});

	it("saves model when only model is patched after provider exists", () => {
		writeConfig({
			personas: [],
			transcription: {
				provider: "openrouter",
				model: "openai/whisper-1",
			},
		});
		applyConfigureValuesPatch({
			"transcription.model": "microsoft/mai-transcribe-1.5",
		});
		const cfg = readConfig();
		expect(cfg.transcription?.provider).toBe("openrouter");
		expect(cfg.transcription?.model).toBe("microsoft/mai-transcribe-1.5");
	});

	it("resets bare openai model when switching to openrouter", () => {
		writeConfig({
			personas: [],
			transcription: { provider: "openai", model: "whisper-1" },
		});
		applyConfigureValuesPatch({ "transcription.provider": "openrouter" });
		const cfg = readConfig();
		expect(cfg.transcription?.provider).toBe("openrouter");
		// Bare "whisper-1" is not a valid OpenRouter slug — should become a slash id.
		expect(cfg.transcription?.model).toContain("/");
		expect(cfg.transcription?.model).not.toBe("whisper-1");
	});
});
