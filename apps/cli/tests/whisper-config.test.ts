import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	resolveDefaultWhisperModelPath,
	resolveWhisperCliInstallTarget,
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

	it("defaults whisper paths under TOBY_DIR", () => {
		expect(resolveWhisperCliInstallTarget()).toBe(
			path.join(tempDir, "helpers", "whisper-cli"),
		);
		expect(resolveDefaultWhisperModelPath()).toBe(
			path.join(tempDir, "models", "ggml-base.en.bin"),
		);
	});

	it("prefers TOBY_WHISPER_CPP_* env overrides", () => {
		process.env.TOBY_WHISPER_CPP_BINARY = "/tmp/custom-whisper-cli";
		process.env.TOBY_WHISPER_CPP_MODEL = "/tmp/custom-model.bin";
		fs.writeFileSync("/tmp/custom-whisper-cli", "");
		fs.chmodSync("/tmp/custom-whisper-cli", 0o755);
		fs.writeFileSync("/tmp/custom-model.bin", "x".repeat(1024));

		const resolved = resolveWhisperCppConfig();
		expect(resolved.binaryPath).toBe("/tmp/custom-whisper-cli");
		expect(resolved.modelPath).toBe("/tmp/custom-model.bin");

		fs.rmSync("/tmp/custom-whisper-cli", { force: true });
		fs.rmSync("/tmp/custom-model.bin", { force: true });
		process.env.TOBY_WHISPER_CPP_BINARY = undefined;
		process.env.TOBY_WHISPER_CPP_MODEL = undefined;
	});
});
