import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeConfig } from "@toby/core/config";
import { applyConfigureValuesPatch } from "@toby/core/configure/persistence";
import { buildSettingsTree } from "@toby/core/configure/tree";
import { transcribeWithModel } from "@toby/core/listen/transcription-model";
import {
	getTranscriptionSetupStatus,
	resolveTranscriptionSelection,
} from "@toby/core/listen/transcription-providers";

describe("Apple transcription", () => {
	let directory: string;
	let previous: string | undefined;
	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), "toby-apple-speech-"));
		previous = process.env.TOBY_DIR;
		process.env.TOBY_DIR = directory;
		writeConfig({
			personas: [],
			transcription: { provider: "apple", model: "speech-transcriber" },
		});
	});
	afterEach(() => {
		if (previous === undefined) Reflect.deleteProperty(process.env, "TOBY_DIR");
		else process.env.TOBY_DIR = previous;
		fs.rmSync(directory, { recursive: true, force: true });
	});

	it("is configured without credentials and omits the API key control", () => {
		expect(resolveTranscriptionSelection()).toEqual({
			provider: "apple",
			model: "speech-transcriber",
			apiKey: "",
		});
		expect(getTranscriptionSetupStatus()).toMatchObject({
			configured: true,
			needsApiKey: false,
		});
		const tree = buildSettingsTree([], [], {
			"transcription.provider": "apple",
			"transcription.model": "speech-transcriber",
		});
		const section = tree.children?.find((item) => item.key === "transcription");
		expect(
			section?.children?.some((item) => item.key?.endsWith(".apiKey")),
		).toBe(false);
	});

	it("switching from a cloud provider resets the model", () => {
		writeConfig({
			personas: [],
			transcription: { provider: "openai", model: "whisper-1" },
		});
		applyConfigureValuesPatch({ "transcription.provider": "apple" });
		expect(resolveTranscriptionSelection()?.model).toBe("speech-transcriber");
	});

	it("reuses complete live text without invoking native or cloud recognition", async () => {
		fs.writeFileSync(
			path.join(directory, "transcript.json"),
			JSON.stringify({
				text: "Meeting notes",
				engine: "apple-live",
				complete: true,
				segments: [],
			}),
		);
		fs.writeFileSync(path.join(directory, "transcript.txt"), "Meeting notes\n");
		// No input file: a second recognition attempt would fail.
		expect(
			await transcribeWithModel({
				input: path.join(directory, "missing.wav"),
				outDir: directory,
				reuseLiveTranscript: true,
			}),
		).toEqual({
			transcript: "transcript.txt",
			transcriptJson: "transcript.json",
		});
	});

	it("manual retry and incomplete live text never silently reuse old words", async () => {
		fs.writeFileSync(
			path.join(directory, "transcript.json"),
			JSON.stringify({
				text: "Partial",
				engine: "apple-live",
				complete: false,
			}),
		);
		fs.writeFileSync(path.join(directory, "transcript.txt"), "Partial\n");
		await expect(
			transcribeWithModel({
				input: path.join(directory, "missing.wav"),
				outDir: directory,
				reuseLiveTranscript: true,
			}),
		).rejects.toMatchObject({ code: "input_missing" });
		fs.writeFileSync(
			path.join(directory, "transcript.json"),
			JSON.stringify({
				text: "Complete",
				engine: "apple-live",
				complete: true,
			}),
		);
		await expect(
			transcribeWithModel({
				input: path.join(directory, "missing.wav"),
				outDir: directory,
			}),
		).rejects.toMatchObject({ code: "input_missing" });
	});
});
