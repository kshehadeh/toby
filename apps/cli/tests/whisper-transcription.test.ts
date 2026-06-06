import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockConfig = vi.hoisted(() => ({
	binaryPath: "",
	modelPath: "",
}));

vi.mock("@toby/core/listen/whisper-config", () => ({
	resolveWhisperCppConfig: () => ({
		binaryPath: mockConfig.binaryPath,
		modelPath: mockConfig.modelPath,
		language: "en",
	}),
}));

vi.mock("node:child_process", async () => {
	const actual =
		await vi.importActual<typeof import("node:child_process")>(
			"node:child_process",
		);
	return {
		...actual,
		spawn: vi.fn(),
	};
});

import { spawn } from "node:child_process";
import { transcribeWithWhisperCpp } from "../src/listen/transcription/whisper-cpp";

describe("whisper transcription", () => {
	const tempDirs: string[] = [];
	let helpersDir = "";

	beforeEach(() => {
		helpersDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-whisper-bin-"));
		tempDirs.push(helpersDir);
		mockConfig.binaryPath = path.join(helpersDir, "whisper-cli");
		mockConfig.modelPath = path.join(helpersDir, "ggml-base.en.bin");
		fs.writeFileSync(mockConfig.binaryPath, "");
		fs.chmodSync(mockConfig.binaryPath, 0o755);
		fs.writeFileSync(mockConfig.modelPath, "model");
	});

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
		vi.mocked(spawn).mockReset();
	});

	it("delegates transcription to the macOS audio helper", async () => {
		const outDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "toby-whisper-transcribe-"),
		);
		tempDirs.push(outDir);
		const input = path.join(outDir, "combined.wav");
		fs.writeFileSync(input, "fake-audio");
		const helperPath = path.join(helpersDir, "toby-listener");
		fs.writeFileSync(helperPath, "");
		fs.chmodSync(helperPath, 0o755);

		vi.mocked(spawn).mockImplementation((_command, args) => {
			const child = new EventEmitter() as import("node:child_process").ChildProcessWithoutNullStreams;
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();

			setImmediate(() => {
				const outDirArg = args?.[args.indexOf("--out-dir") + 1];
				if (typeof outDirArg !== "string") {
					child.emit("exit", 1);
					return;
				}
				const transcriptPath = path.join(outDirArg, "transcript.txt");
				const transcriptJsonPath = path.join(outDirArg, "transcript.json");
				const payload = {
					text: "Hello world",
					segments: [
						{
							text: "Hello world",
							timestamp: 0,
							duration: 1.2,
							confidence: 0,
							alternatives: [],
						},
					],
					sourceAudio: input,
					createdAt: "2026-06-06T12:00:00.000Z",
					locale: "en_US",
				};
				fs.writeFileSync(transcriptPath, "Hello world\n");
				fs.writeFileSync(transcriptJsonPath, JSON.stringify(payload));
				child.stdout.emit(
					"data",
					Buffer.from(
						`${JSON.stringify({
							type: "transcribed",
							files: {
								transcript: transcriptPath,
								transcriptJson: transcriptJsonPath,
							},
						})}\n`,
					),
				);
				child.emit("exit", 0);
			});

			return child;
		});

		const files = await transcribeWithWhisperCpp({
			input,
			outDir,
			helperPath,
		});
		expect(vi.mocked(spawn)).toHaveBeenCalledWith(
			helperPath,
			[
				"transcribe",
				"--input",
				input,
				"--out-dir",
				outDir,
				"--whisper-cli",
				mockConfig.binaryPath,
				"--model",
				mockConfig.modelPath,
				"--language",
				"en",
			],
			expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
		);
		expect(files.transcript).toBeDefined();
		expect(files.transcriptJson).toBeDefined();
		expect(fs.readFileSync(files.transcript ?? "", "utf8").trim()).toBe(
			"Hello world",
		);
		const payload = JSON.parse(
			fs.readFileSync(files.transcriptJson ?? "", "utf8"),
		) as {
			text: string;
			segments: Array<{ text: string; timestamp: number }>;
		};
		expect(payload.text).toBe("Hello world");
		expect(payload.segments[0]?.text).toBe("Hello world");
	});
});
