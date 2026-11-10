import { beforeEach, describe, expect, it, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	buildListenMetadata,
	prepareListenSession,
	saveListenSession,
} from "@toby/core/listen/session-controller";
import * as actualSummarizer from "@toby/core/listen/summarizer";
import { closeChatDbForTests } from "@toby/core/session-store";
import { handleWebRequest } from "@toby/core/web/routes";

const summarizeMock = mock(
	async (
		_params: Parameters<
			typeof actualSummarizer.summarizeRecordingTranscript
		>[0],
	) => ({
		text: "Decided to ship automatic recording summaries.",
		personaName: "Toby",
		createdAt: "2026-11-10T18:00:00.000Z",
	}),
);

const titleMock = mock(
	async (
		_params: Parameters<typeof actualSummarizer.generateTitleFromSummary>[0],
	) => ({
		title: "Ship automatic summaries",
	}),
);

mock.module("@toby/core/listen/summarizer", () => ({
	...actualSummarizer,
	summarizeRecordingTranscript: (
		params: Parameters<typeof actualSummarizer.summarizeRecordingTranscript>[0],
	) => summarizeMock(params),
	generateTitleFromSummary: (
		params: Parameters<typeof actualSummarizer.generateTitleFromSummary>[0],
	) => titleMock(params),
}));

function withTempTobyDir(run: () => Promise<void>): Promise<void> {
	const previous = process.env.TOBY_DIR;
	const dir = fs.mkdtempSync(
		path.join(os.tmpdir(), "toby-listen-auto-summary-"),
	);
	process.env.TOBY_DIR = dir;
	return run().finally(() => {
		closeChatDbForTests();
		if (previous === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previous;
		}
		fs.rmSync(dir, { recursive: true, force: true });
	});
}

/**
 * Toby.app stops in NativeAudioHandler, then posts this exact request:
 * Accept: text/event-stream, body `{ reuseLiveTranscript: true }`.
 */
function appStopTranscribeRequest(id: string): Request {
	return new Request(
		`http://127.0.0.1/api/listen/recordings/${id}/transcribe`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "text/event-stream",
			},
			body: JSON.stringify({ reuseLiveTranscript: true }),
		},
	);
}

function saveNativeStyleRecording(options: {
	readonly id: string;
	readonly transcript: string;
	readonly name?: string;
}): string {
	const recordingsDir = path.join(
		process.env.TOBY_DIR ?? "",
		"listen",
		"recordings",
	);
	const session = prepareListenSession({
		recordingsDir,
		id: options.id,
		now: new Date("2026-11-10T15:00:00.000Z"),
		sources: { mic: true, system: true },
	});
	const outputDir = saveListenSession(
		session,
		buildListenMetadata({
			session,
			stoppedAt: new Date("2026-11-10T15:05:00.000Z"),
			helperPath: "Toby.app",
			helperVersion: "native-app",
			files: {
				mic: "mic.wav",
				system: "system.wav",
				combined: "combined.m4a",
			},
		}),
	);
	fs.writeFileSync(path.join(outputDir, "combined.m4a"), "audio");
	fs.writeFileSync(
		path.join(outputDir, "transcript.txt"),
		`${options.transcript}\n`,
	);
	fs.writeFileSync(
		path.join(outputDir, "transcript.json"),
		JSON.stringify({
			engine: "apple-live",
			complete: true,
			text: options.transcript,
			segments: [],
		}),
	);
	if (options.name) {
		const metadataPath = path.join(outputDir, "metadata.json");
		const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as {
			name?: string;
		};
		metadata.name = options.name;
		fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
	}
	return outputDir;
}

function parseSse(raw: string): Array<{ event: string; data: unknown }> {
	const events: Array<{ event: string; data: unknown }> = [];
	for (const block of raw.split("\n\n")) {
		let event = "";
		let data = "";
		for (const line of block.split("\n")) {
			if (line.startsWith(":")) continue;
			if (line.startsWith("event: ")) event = line.slice(7).trim();
			if (line.startsWith("data: ")) data = line.slice(6);
		}
		if (!event || !data) continue;
		events.push({ event, data: JSON.parse(data) as unknown });
	}
	return events;
}

describe("auto-summary after Toby.app stop transcription", () => {
	beforeEach(() => {
		summarizeMock.mockReset();
		summarizeMock.mockImplementation(async () => ({
			text: "Decided to ship automatic recording summaries.",
			personaName: "Toby",
			createdAt: "2026-11-10T18:00:00.000Z",
		}));
		titleMock.mockReset();
		titleMock.mockImplementation(async () => ({
			title: "Ship automatic summaries",
		}));
	});

	it("summarizes and titles when the app's SSE stop request finishes transcription", async () => {
		await withTempTobyDir(async () => {
			const transcript =
				"We agreed to generate a summary as soon as a recording stops.";
			const outputDir = saveNativeStyleRecording({
				id: "app-stop-recording",
				transcript,
			});

			const response = await handleWebRequest(
				appStopTranscribeRequest("app-stop-recording"),
				null,
			);

			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain(
				"text/event-stream",
			);
			const events = parseSse(await response.text());
			const statuses = events
				.filter((event) => event.event === "status")
				.map((event) => (event.data as { message?: string }).message);
			expect(statuses).toContain("Summarizing recording…");
			expect(statuses).toContain("Naming recording…");

			const done = events.find((event) => event.event === "done");
			expect(done?.data).toMatchObject({
				hasTranscript: true,
				hasSummary: true,
				summary: "Decided to ship automatic recording summaries.",
				metadata: {
					name: "Ship automatic summaries",
					summary: { personaName: "Toby" },
				},
			});
			expect(summarizeMock).toHaveBeenCalledTimes(1);
			expect(summarizeMock).toHaveBeenCalledWith(
				expect.objectContaining({ transcript }),
			);
			expect(titleMock).toHaveBeenCalledTimes(1);
			expect(
				fs.readFileSync(path.join(outputDir, "summary.md"), "utf8").trim(),
			).toBe("Decided to ship automatic recording summaries.");
			const metadata = JSON.parse(
				fs.readFileSync(path.join(outputDir, "metadata.json"), "utf8"),
			) as { name?: string; errors?: string[] };
			expect(metadata.name).toBe("Ship automatic summaries");
			expect(metadata.errors).toBeUndefined();
		});
	});

	it("keeps a name the user already set", async () => {
		await withTempTobyDir(async () => {
			saveNativeStyleRecording({
				id: "named-recording",
				transcript: "Standup notes.",
				name: "Weekly standup",
			});

			const response = await handleWebRequest(
				appStopTranscribeRequest("named-recording"),
				null,
			);
			const events = parseSse(await response.text());
			const done = events.find((event) => event.event === "done");
			expect(done?.data).toMatchObject({
				hasSummary: true,
				metadata: { name: "Weekly standup" },
			});
			expect(titleMock).not.toHaveBeenCalled();
		});
	});

	it("keeps the transcript when auto-summarization fails and records the error", async () => {
		await withTempTobyDir(async () => {
			const outputDir = saveNativeStyleRecording({
				id: "summary-failed-recording",
				transcript: "The model was down.",
			});
			summarizeMock.mockImplementation(async () => {
				throw new Error("AI model unavailable");
			});

			const response = await handleWebRequest(
				appStopTranscribeRequest("summary-failed-recording"),
				null,
			);
			expect(response.status).toBe(200);
			const events = parseSse(await response.text());
			const done = events.find((event) => event.event === "done");
			expect(done?.data).toMatchObject({
				hasTranscript: true,
				hasSummary: false,
				metadata: {
					errors: ["Auto-summarization failed: AI model unavailable"],
				},
			});
			expect(
				(done?.data as { metadata?: { name?: string } }).metadata?.name,
			).toBeUndefined();
			expect(fs.existsSync(path.join(outputDir, "summary.md"))).toBe(false);
			expect(titleMock).not.toHaveBeenCalled();
		});
	});

	it("still summarizes the JSON transcribe route used to retry a recording", async () => {
		await withTempTobyDir(async () => {
			saveNativeStyleRecording({
				id: "json-retry-recording",
				transcript: "Retry this take.",
			});

			const response = await handleWebRequest(
				new Request(
					"http://127.0.0.1/api/listen/recordings/json-retry-recording/transcribe",
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ reuseLiveTranscript: true }),
					},
				),
				null,
			);

			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				hasSummary?: boolean;
				metadata?: { name?: string };
			};
			expect(body.hasSummary).toBe(true);
			expect(body.metadata?.name).toBe("Ship automatic summaries");
		});
	});
});
