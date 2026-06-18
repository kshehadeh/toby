import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createListenChatTools } from "@toby/core/ai/listen-chat-tools";
import {
	deleteListenRecordingById,
	findListenRecordingById,
	listListenRecordings,
	readListenTranscript,
	recordingHasAudio,
	recordingHasTranscript,
} from "@toby/core/listen/recordings";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildListenMetadata,
	prepareListenSession,
	saveListenSession,
} from "../src/listen/session-controller";

const tempDirs: string[] = [];

function tempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-listen-recordings-"));
	tempDirs.push(dir);
	return dir;
}

function saveRecording(params: {
	readonly dir: string;
	readonly id: string;
	readonly startedAt: string;
	readonly name?: string;
	readonly description?: string;
	readonly transcriptText?: string;
	readonly transcriptJson?: unknown;
	readonly combined?: boolean;
}): string {
	const session = prepareListenSession({
		recordingsDir: params.dir,
		id: params.id,
		now: new Date(params.startedAt),
		sources: { mic: true, system: true },
	});
	const outputDir = saveListenSession(
		session,
		buildListenMetadata({
			session,
			stoppedAt: new Date(Date.parse(params.startedAt) + 1000),
			files: {
				combined: params.combined ? "combined.m4a" : undefined,
				transcript: params.transcriptText ? "transcript.txt" : undefined,
				transcriptJson: params.transcriptJson ? "transcript.json" : undefined,
			},
		}),
	);
	if (params.name || params.description) {
		const metadata = JSON.parse(
			fs.readFileSync(path.join(outputDir, "metadata.json"), "utf8"),
		) as { name?: string; description?: string };
		if (params.name) metadata.name = params.name;
		if (params.description) metadata.description = params.description;
		fs.writeFileSync(
			path.join(outputDir, "metadata.json"),
			`${JSON.stringify(metadata, null, 2)}\n`,
		);
	}
	if (params.combined) {
		fs.writeFileSync(path.join(outputDir, "combined.m4a"), "audio");
	}
	if (params.transcriptText) {
		fs.writeFileSync(
			path.join(outputDir, "transcript.txt"),
			`${params.transcriptText}\n`,
		);
	}
	if (params.transcriptJson) {
		fs.writeFileSync(
			path.join(outputDir, "transcript.json"),
			`${JSON.stringify(params.transcriptJson)}\n`,
		);
	}
	return outputDir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("listen recordings core", () => {
	it("lists recordings newest first with transcript/audio flags", () => {
		const dir = tempDir();
		saveRecording({
			dir,
			id: "older",
			startedAt: "2026-05-21T12:00:00Z",
			transcriptText: "older transcript",
			combined: true,
		});
		saveRecording({
			dir,
			id: "newer",
			startedAt: "2026-05-21T13:00:00Z",
			name: "Standup",
			transcriptText: "newer transcript",
			combined: true,
		});

		const recordings = listListenRecordings(dir);
		expect(recordings.map((recording) => recording.id)).toEqual([
			"newer",
			"older",
		]);
		expect(recordingHasTranscript(recordings[0])).toBe(true);
		expect(recordingHasAudio(recordings[0])).toBe(true);
	});

	it("reads plain transcript text", () => {
		const dir = tempDir();
		const outputDir = saveRecording({
			dir,
			id: "with-text",
			startedAt: "2026-05-21T12:00:00Z",
			transcriptText: "Hello from the meeting.",
		});

		const result = readListenTranscript(outputDir);
		expect(result).toEqual({ ok: true, text: "Hello from the meeting." });
	});

	it("reads segments when includeSegments is true", () => {
		const dir = tempDir();
		const outputDir = saveRecording({
			dir,
			id: "with-json",
			startedAt: "2026-05-21T12:00:00Z",
			transcriptText: "Segmented transcript.",
			transcriptJson: {
				text: "Segmented transcript.",
				segments: [
					{
						text: "Segmented transcript.",
						timestamp: 0,
						duration: 1.2,
						confidence: 0,
						alternatives: [],
					},
				],
				sourceAudio: "combined.m4a",
				createdAt: "2026-05-21T12:00:01Z",
				locale: "en_US",
			},
		});

		const result = readListenTranscript(outputDir, { includeSegments: true });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.text).toBe("Segmented transcript.");
		expect(result.segments).toHaveLength(1);
		expect(result.locale).toBe("en_US");
	});

	it("returns an error when transcript is missing", () => {
		const dir = tempDir();
		const outputDir = saveRecording({
			dir,
			id: "no-transcript",
			startedAt: "2026-05-21T12:00:00Z",
			combined: true,
		});

		const result = readListenTranscript(outputDir);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toContain("No transcript is available");
	});

	it("finds recordings by id", () => {
		const dir = tempDir();
		saveRecording({
			dir,
			id: "target-id",
			startedAt: "2026-05-21T12:00:00Z",
		});

		expect(findListenRecordingById("target-id", dir)?.id).toBe("target-id");
		expect(findListenRecordingById("missing", dir)).toBeNull();
	});

	it("deletes recordings by id", () => {
		const dir = tempDir();
		const outputDir = saveRecording({
			dir,
			id: "delete-me",
			startedAt: "2026-05-21T12:00:00Z",
		});

		expect(deleteListenRecordingById("delete-me", dir)).toBe(true);
		expect(fs.existsSync(outputDir)).toBe(false);
		expect(deleteListenRecordingById("delete-me", dir)).toBe(false);
	});
});

describe("listen chat tools", () => {
	it("listListenRecordings returns summaries", async () => {
		const dir = tempDir();
		const previous = process.env.TOBY_DIR;
		process.env.TOBY_DIR = path.join(dir, "toby-home");
		fs.mkdirSync(path.join(process.env.TOBY_DIR, "listen", "recordings"), {
			recursive: true,
		});
		const recordingsRoot = path.join(
			process.env.TOBY_DIR,
			"listen",
			"recordings",
		);
		saveRecording({
			dir: recordingsRoot,
			id: "chat-list",
			startedAt: "2026-05-21T12:00:00Z",
			name: "Planning",
			transcriptText: "Plan the release.",
			combined: true,
		});

		const tools = createListenChatTools();
		const result = await tools.listListenRecordings.execute?.(
			{ limit: 10 },
			{} as never,
		);

		if (previous === undefined) {
			process.env.TOBY_DIR = undefined;
		} else {
			process.env.TOBY_DIR = previous;
		}

		expect(result).toMatchObject({
			ok: true,
			recordings: [
				{
					id: "chat-list",
					name: "Planning",
					hasTranscript: true,
					hasAudio: true,
				},
			],
		});
	});

	it("readTranscript returns text and errors for missing ids", async () => {
		const dir = tempDir();
		const previous = process.env.TOBY_DIR;
		process.env.TOBY_DIR = path.join(dir, "toby-home");
		const recordingsRoot = path.join(
			process.env.TOBY_DIR,
			"listen",
			"recordings",
		);
		fs.mkdirSync(recordingsRoot, { recursive: true });
		saveRecording({
			dir: recordingsRoot,
			id: "readable",
			startedAt: "2026-05-21T12:00:00Z",
			transcriptText: "Readable transcript body.",
		});

		const tools = createListenChatTools();
		const found = await tools.readTranscript.execute?.(
			{ recordingId: "readable" },
			{} as never,
		);
		const missing = await tools.readTranscript.execute?.(
			{ recordingId: "does-not-exist" },
			{} as never,
		);

		if (previous === undefined) {
			process.env.TOBY_DIR = undefined;
		} else {
			process.env.TOBY_DIR = previous;
		}

		expect(found).toMatchObject({
			ok: true,
			recordingId: "readable",
			text: "Readable transcript body.",
		});
		expect(missing).toMatchObject({
			ok: false,
			error: expect.stringContaining("No listen recording found"),
		});
	});
});
