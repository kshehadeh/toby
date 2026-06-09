import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const pluginToolsExecuteAsync = vi.hoisted(() => vi.fn());
const findDiscoveredPlugin = vi.hoisted(() => vi.fn());
const inspectPluginBinary = vi.hoisted(() => vi.fn());

vi.mock("@toby/core/integrations/plugins/client", () => ({
	pluginToolsExecuteAsync,
	pluginSetup: vi.fn(),
}));

vi.mock("@toby/core/integrations/plugins/registry", () => ({
	findDiscoveredPlugin,
	inspectPluginBinary,
}));

vi.mock("@toby/core/config/index", async () => {
	const actual = await vi.importActual<
		typeof import("@toby/core/config/index")
	>("@toby/core/config/index");
	return {
		...actual,
		readConfig: () => ({
			integrations: {},
			personas: [],
			listen: { transcriptionPlugin: "whisper" },
		}),
		readCredentials: () => ({ integrations: { whisper: {} } }),
		writeConfig: vi.fn(),
		writeCredentials: vi.fn(),
		getDefaultProvider: () => undefined,
	};
});

import { transcribeWithPlugin } from "@toby/core/listen/transcription-plugin";

describe("transcription plugin bridge", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
		vi.clearAllMocks();
	});

	it("copies plugin temp transcript files into the recording folder", async () => {
		const outDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "toby-transcription-out-"),
		);
		tempDirs.push(outDir);
		const input = path.join(outDir, "combined.m4a");
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

		findDiscoveredPlugin.mockReturnValue({
			binaryPath: "/fake/toby-plugin-whisper",
			binaryName: "toby-plugin-whisper",
		});
		inspectPluginBinary.mockReturnValue({
			capabilities: ["transcription"],
			name: "whisper",
		});
		pluginToolsExecuteAsync.mockResolvedValue({
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
		expect(pluginToolsExecuteAsync).toHaveBeenCalledWith(
			"/fake/toby-plugin-whisper",
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
