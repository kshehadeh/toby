import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	resolveDefaultWhisperModelPath,
	resolveWhisperCppConfig,
} from "@toby/core/listen/whisper-config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("whisper config", () => {
	let tempDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-whisper-config-"));
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = tempDir;
		fs.mkdirSync(path.join(tempDir, "helpers"), { recursive: true });
	});

	afterEach(() => {
		if (previousTobyDir === undefined) {
			process.env.TOBY_DIR = undefined;
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("defaults whisper model path under TOBY_DIR", () => {
		expect(resolveDefaultWhisperModelPath()).toBe(
			path.join(tempDir, "models", "ggml-base.en.bin"),
		);
	});

	it("prefers TOBY_WHISPER_CPP_* env overrides for model and language", () => {
		process.env.TOBY_WHISPER_CPP_MODEL = "/tmp/custom-model.bin";
		process.env.TOBY_WHISPER_CPP_LANGUAGE = "en";

		const resolved = resolveWhisperCppConfig();
		expect(resolved.modelPath).toBe("/tmp/custom-model.bin");
		expect(resolved.language).toBe("en");

		process.env.TOBY_WHISPER_CPP_MODEL = undefined;
		process.env.TOBY_WHISPER_CPP_LANGUAGE = undefined;
	});
});
