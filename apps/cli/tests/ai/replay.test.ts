import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createModelForPersona } from "@toby/core/ai/model-factory";
import {
	beginRecording,
	beginReplay,
	createRecordMiddleware,
	createReplayModel,
	endSession,
	flushRecording,
	parseRecording,
	resetReplaySessionForTests,
} from "@toby/core/ai/replay";
import type { Persona } from "@toby/core/config/index";
import { generateText, streamText, wrapLanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir: string;
let previousTobyDir: string | undefined;

const GENERATE_RESULT = {
	content: [{ type: "text" as const, text: "Hello from generate" }],
	finishReason: "stop" as const,
	usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
	warnings: [],
};

const STREAM_CHUNKS = [
	{ type: "stream-start" as const, warnings: [] },
	{ type: "text-start" as const, id: "text-1" },
	{ type: "text-delta" as const, id: "text-1", delta: "Hello" },
	{ type: "text-delta" as const, id: "text-1", delta: " stream" },
	{ type: "text-end" as const, id: "text-1" },
	{
		type: "finish" as const,
		finishReason: "stop" as const,
		usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
	},
];

function testPersona(): Persona {
	return {
		name: "Test",
		instructions: "",
		promptMode: "add",
		ai: { provider: "openai", model: "gpt-4.1-mini" },
	};
}

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-replay-"));
	previousTobyDir = process.env.TOBY_DIR;
	process.env.TOBY_DIR = tempDir;
	resetReplaySessionForTests();
});

afterEach(() => {
	resetReplaySessionForTests();
	if (previousTobyDir === undefined) {
		process.env.TOBY_DIR = undefined;
	} else {
		process.env.TOBY_DIR = previousTobyDir;
	}
	fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("chat replay recording", () => {
	it("records generate and stream model calls to a JSON file", async () => {
		const recordingPath = path.join(tempDir, "session.json");
		beginRecording(recordingPath, {
			provider: "openai",
			model: "gpt-4.1-mini",
		});

		const mock = new MockLanguageModelV3({
			doGenerate: async () => GENERATE_RESULT,
			doStream: async () => ({
				stream: new ReadableStream({
					start(controller) {
						for (const chunk of STREAM_CHUNKS) {
							controller.enqueue(chunk);
						}
						controller.close();
					},
				}),
			}),
		});

		const model = wrapLanguageModel({
			model: mock,
			middleware: createRecordMiddleware(),
		});

		const generate = await generateText({
			model,
			prompt: "Say hello",
		});
		expect(generate.text).toBe("Hello from generate");
		expect(mock.doGenerateCalls).toHaveLength(1);

		const stream = await streamText({
			model,
			prompt: "Stream hello",
		});
		let streamed = "";
		for await (const delta of stream.textStream) {
			streamed += delta;
		}
		expect(streamed).toBe("Hello stream");
		expect(mock.doStreamCalls).toHaveLength(1);

		flushRecording();
		expect(fs.existsSync(recordingPath)).toBe(true);

		const parsed = parseRecording(fs.readFileSync(recordingPath, "utf8"));
		expect(parsed.version).toBe(1);
		expect(parsed.entries).toHaveLength(2);
		expect(parsed.entries[0]?.op).toBe("generate");
		expect(parsed.entries[1]?.op).toBe("stream");
		if (parsed.entries[0]?.op === "generate") {
			expect(parsed.entries[0].result.content[0]).toEqual({
				type: "text",
				text: "Hello from generate",
			});
		}
	});

	it("replays recorded responses without calling the provider", async () => {
		const recordingPath = path.join(tempDir, "replay.json");
		beginRecording(recordingPath, {
			provider: "openai",
			model: "gpt-4.1-mini",
		});

		const providerMock = new MockLanguageModelV3({
			doGenerate: async () => GENERATE_RESULT,
			doStream: async () => ({
				stream: new ReadableStream({
					start(controller) {
						for (const chunk of STREAM_CHUNKS) {
							controller.enqueue(chunk);
						}
						controller.close();
					},
				}),
			}),
		});

		const recordingModel = wrapLanguageModel({
			model: providerMock,
			middleware: createRecordMiddleware(),
		});

		await generateText({ model: recordingModel, prompt: "record generate" });
		const recordedStream = streamText({
			model: recordingModel,
			prompt: "record stream",
		});
		for await (const _delta of recordedStream.textStream) {
			// drain
		}
		flushRecording();
		endSession();

		beginReplay(recordingPath);
		const replayModel = createReplayModel(testPersona());
		const replayProviderSpy = vi.spyOn(replayModel, "doGenerate");

		const generate = await generateText({
			model: replayModel,
			prompt: "record generate",
		});
		expect(generate.text).toBe("Hello from generate");
		expect(providerMock.doGenerateCalls).toHaveLength(1);
		expect(replayProviderSpy).toHaveBeenCalledTimes(1);

		const stream = streamText({
			model: replayModel,
			prompt: "record stream",
		});
		let streamed = "";
		for await (const delta of stream.textStream) {
			streamed += delta;
		}
		expect(streamed).toBe("Hello stream");
		expect(providerMock.doStreamCalls).toHaveLength(1);
		expect(providerMock.doGenerateCalls).toHaveLength(1);
	});

	it("createModelForPersona returns replay model without credentials in replay mode", async () => {
		const recordingPath = path.join(tempDir, "factory-replay.json");
		fs.writeFileSync(
			recordingPath,
			`${JSON.stringify(
				{
					version: 1,
					createdAt: new Date().toISOString(),
					persona: { provider: "openai", model: "gpt-4.1-mini" },
					entries: [
						{
							op: "generate",
							paramsDigest: "unused",
							result: GENERATE_RESULT,
						},
					],
				},
				null,
				2,
			)}\n`,
			"utf8",
		);

		beginReplay(recordingPath);
		const model = createModelForPersona(testPersona());
		const result = await generateText({
			model,
			prompt: "anything",
		});
		expect(result.text).toBe("Hello from generate");
	});
});

describe("computeParamsDigest stability", () => {
	it("ignores injected datetime blocks when digesting", async () => {
		const { computeParamsDigest, normalizeCallParams } = await import(
			"@toby/core/ai/replay/recording-format"
		);
		const baseParams = {
			prompt: [
				{
					role: "system" as const,
					content: "You are Toby.",
				},
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: "Hello" }],
				},
			],
		};
		const withDatetime = {
			prompt: [
				{
					role: "system" as const,
					content:
						"You are Toby.\n\n<!-- TOBY_DATETIME_START -->\nnow\n<!-- TOBY_DATETIME_END -->",
				},
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: "Hello" }],
				},
			],
		};

		expect(computeParamsDigest(withDatetime)).toBe(
			computeParamsDigest(normalizeCallParams(baseParams)),
		);
	});
});
