import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

let findDiscoveredPluginReturn: unknown;
const mockFindDiscoveredPlugin = mock(() => findDiscoveredPluginReturn);

let inspectPluginBinaryReturn: unknown;
const mockInspectPluginBinary = mock(() => inspectPluginBinaryReturn);

let pluginToolsExecuteAsyncReturn: unknown;
const mockPluginToolsExecuteAsync = mock(() => pluginToolsExecuteAsyncReturn);

mock.module("@toby/core/integrations/plugins/client", () => ({
	pluginToolsExecuteAsync: mockPluginToolsExecuteAsync,
	pluginSetup: () => {},
}));

mock.module("@toby/core/integrations/plugins/registry", () => ({
	findDiscoveredPlugin: mockFindDiscoveredPlugin,
	inspectPluginBinary: mockInspectPluginBinary,
}));

import { transcribeWithPlugin } from "@toby/core/listen/transcription-plugin";

describe("transcription plugin bridge", () => {
	const tempDirs: string[] = [];
	let originalTobyDir: string | undefined;

	beforeEach(() => {
		originalTobyDir = process.env.TOBY_DIR;
		const dir = fs.mkdtempSync(
			path.join(os.tmpdir(), "toby-whisper-transcription-test-"),
		);
		tempDirs.push(dir);
		process.env.TOBY_DIR = dir;
		fs.mkdirSync(path.join(dir, "listen", "recordings"), { recursive: true });
		fs.writeFileSync(
			path.join(dir, "config.json"),
			JSON.stringify({
				integrations: {},
				personas: [],
				listen: { transcriptionPlugin: "whisper" },
			}),
		);
		fs.writeFileSync(
			path.join(dir, "credentials.json"),
			JSON.stringify({ integrations: { whisper: {} } }),
		);
	});

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
		mockFindDiscoveredPlugin.mockClear?.();
		mockInspectPluginBinary.mockClear?.();
		mockPluginToolsExecuteAsync.mockClear?.();
		if (originalTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = originalTobyDir;
		}
	});

	it("copies plugin temp transcript files into the recording folder", async () => {
		const outDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "toby-transcription-out-"),
		);
		tempDirs.push(outDir);
		const input = path.join(outDir, "combined.wav");
		fs.writeFileSync(input, "fake-audio");

		const tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "TobyTranscription-test-"),
		);
		tempDirs.push(tmpDir);
		const transcriptPath = path.join(tmpDir, "transcript.txt");
		const transcriptJsonPath = path.join(tmpDir, "transcript.json");
		fs.writeFileSync(transcriptPath, "Hello world\n");
		fs.writeFileSync(
			transcriptJsonPath,
			JSON.stringify({
				text: "Hello world",
				segments: [],
				sourceAudio: input,
				createdAt: "2026-06-06T12:00:00.000Z",
				locale: "en_US",
			}),
		);

		findDiscoveredPluginReturn = {
			kind: "binary",
			binaryPath: "/fake/toby-plugin-whisper",
			binaryName: "toby-plugin-whisper",
		};
		inspectPluginBinaryReturn = {
			capabilities: ["transcription"],
			name: "whisper",
		};
		pluginToolsExecuteAsyncReturn = Promise.resolve({
			ok: true,
			data: {
				ok: true,
				result: {
					transcriptPath,
					transcriptJsonPath,
				},
			},
			stderr: "",
		});

		const files = await transcribeWithPlugin({ input, outDir });
		expect(mockPluginToolsExecuteAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "binary",
				executablePath: "/fake/toby-plugin-whisper",
			}),
			expect.objectContaining({
				tool: "doTranscription",
				input: { audioFilePath: input },
			}),
			expect.objectContaining({ timeoutMs: expect.any(Number) }),
		);
		expect(files.transcript).toBe("transcript.txt");
		expect(files.transcriptJson).toBe("transcript.json");
		expect(
			fs.readFileSync(path.join(outDir, "transcript.txt"), "utf8").trim(),
		).toBe("Hello world");
	});
});
