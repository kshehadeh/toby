import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	applyTranscriptFilesToMetadata,
	registerListenCommand,
	resolveTranscriptionAudioInput,
} from "../src/commands/listen";
import {
	parseAudioHelperEvent,
	resolveAudioHelperPath,
	waitForAudioHelperExit,
} from "../src/listen/macos/audio-capture";
import {
	buildListenMetadata,
	deleteListenRecording,
	discardListenSession,
	listListenRecordings,
	metadataPath,
	prepareListenSession,
	remapListenFilesToFinalDir,
	saveListenSession,
	updateListenRecordingMetadata,
} from "../src/listen/session-controller";

const tempDirs: string[] = [];

function tempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-listen-test-"));
	tempDirs.push(dir);
	return dir;
}

function fakeHelperChild(): ChildProcessWithoutNullStreams {
	const child = new EventEmitter() as EventEmitter & {
		exitCode: number | null;
		killed: boolean;
		kill: ReturnType<typeof vi.fn>;
	};
	child.exitCode = null;
	child.killed = false;
	child.kill = vi.fn(() => {
		child.killed = true;
		child.emit("exit", null, "SIGTERM");
		return true;
	});
	return child as unknown as ChildProcessWithoutNullStreams;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("listen command", () => {
	it("registers a root listen command with source options", () => {
		const program = new Command();
		registerListenCommand(program);

		const listen = program.commands.find((cmd) => cmd.name() === "listen");
		expect(listen).toBeDefined();
		expect(listen?.options.map((option) => option.long)).toContain(
			"--mic-only",
		);
		expect(listen?.options.map((option) => option.long)).toContain(
			"--system-only",
		);
		expect(listen?.options.map((option) => option.long)).toContain("--helper");
	});

	it("registers a retry transcription subcommand", () => {
		const program = new Command();
		registerListenCommand(program);

		const listen = program.commands.find((cmd) => cmd.name() === "listen");
		const transcribe = listen?.commands.find(
			(cmd) => cmd.name() === "transcribe",
		);

		expect(transcribe).toBeDefined();
		expect(transcribe?.options.map((option) => option.long)).toContain(
			"--helper",
		);
	});
});

describe("listen session storage", () => {
	it("creates temp and final recording paths", () => {
		const dir = tempDir();
		const session = prepareListenSession({
			recordingsDir: dir,
			id: "rec-1",
			now: new Date("2026-05-21T12:00:00Z"),
			sources: { mic: true, system: false },
		});

		expect(session.tempDir).toBe(path.join(dir, ".tmp", "rec-1"));
		expect(session.finalDir).toBe(path.join(dir, "rec-1"));
		expect(fs.existsSync(session.tempDir)).toBe(true);
	});

	it("saves metadata with duration and files", () => {
		const dir = tempDir();
		const session = prepareListenSession({
			recordingsDir: dir,
			id: "rec-2",
			now: new Date("2026-05-21T12:00:00Z"),
			sources: { mic: true, system: true },
		});
		fs.writeFileSync(path.join(session.tempDir, "mic.wav"), "");
		const metadata = buildListenMetadata({
			session,
			stoppedAt: new Date("2026-05-21T12:00:05Z"),
			files: { mic: "mic.wav", system: "system.wav", combined: "combined.m4a" },
		});

		const finalDir = saveListenSession(session, metadata);
		const saved = JSON.parse(
			fs.readFileSync(metadataPath(finalDir), "utf8"),
		) as typeof metadata;

		expect(finalDir).toBe(path.join(dir, "rec-2"));
		expect(saved.durationMs).toBe(5000);
		expect(saved.files.mic).toBe("mic.wav");
		expect(saved.files.combined).toBe("combined.m4a");
	});

	it("discards temp recordings", () => {
		const dir = tempDir();
		const session = prepareListenSession({
			recordingsDir: dir,
			id: "rec-3",
			sources: { mic: false, system: true },
		});

		discardListenSession(session);

		expect(fs.existsSync(session.tempDir)).toBe(false);
	});

	it("lists saved recordings newest first and deletes them", () => {
		const dir = tempDir();
		for (const [id, startedAt] of [
			["older", "2026-05-21T12:00:00Z"],
			["newer", "2026-05-21T13:00:00Z"],
		] as const) {
			const session = prepareListenSession({
				recordingsDir: dir,
				id,
				now: new Date(startedAt),
				sources: { mic: true, system: true },
			});
			const metadata = buildListenMetadata({
				session,
				stoppedAt: new Date(Date.parse(startedAt) + 1000),
				files: { combined: "combined.m4a" },
			});
			saveListenSession(session, metadata);
		}

		const recordings = listListenRecordings(dir);
		expect(recordings.map((recording) => recording.id)).toEqual([
			"newer",
			"older",
		]);

		deleteListenRecording(recordings[0]);

		expect(listListenRecordings(dir).map((recording) => recording.id)).toEqual([
			"older",
		]);
	});

	it("updates recording name and description metadata", () => {
		const dir = tempDir();
		const session = prepareListenSession({
			recordingsDir: dir,
			id: "named",
			now: new Date("2026-05-21T12:00:00Z"),
			sources: { mic: true, system: true },
		});
		const metadata = buildListenMetadata({
			session,
			stoppedAt: new Date("2026-05-21T12:00:01Z"),
			files: { combined: "combined.m4a" },
		});
		saveListenSession(session, metadata);
		const [recording] = listListenRecordings(dir);

		const updated = updateListenRecordingMetadata(recording, {
			name: "Team sync",
			description: "Notes from the weekly sync.",
		});
		const saved = JSON.parse(
			fs.readFileSync(metadataPath(updated.dir), "utf8"),
		) as typeof metadata;

		expect(saved.name).toBe("Team sync");
		expect(saved.description).toBe("Notes from the weekly sync.");
	});

	it("resolves transcription input from metadata or folder fallback", () => {
		const dir = tempDir();
		const metadataCombined = path.join(dir, "from-metadata.m4a");
		const fallbackCombined = path.join(dir, "combined.m4a");
		fs.writeFileSync(metadataCombined, "");
		fs.writeFileSync(fallbackCombined, "");

		expect(
			resolveTranscriptionAudioInput(dir, {
				id: "rec",
				createdAt: "2026-05-21T12:00:00Z",
				startedAt: "2026-05-21T12:00:00Z",
				sources: { mic: true, system: true },
				files: { combined: metadataCombined },
				platform: process.platform,
			}),
		).toBe(metadataCombined);

		expect(
			resolveTranscriptionAudioInput(dir, {
				id: "rec",
				createdAt: "2026-05-21T12:00:00Z",
				startedAt: "2026-05-21T12:00:00Z",
				sources: { mic: true, system: true },
				files: { combined: path.join(dir, "missing.m4a") },
				platform: process.platform,
			}),
		).toBe(fallbackCombined);
	});

	it("remaps capture file paths from temp dir to final recording dir", () => {
		const dir = tempDir();
		const session = prepareListenSession({
			recordingsDir: dir,
			id: "remap-test",
			sources: { mic: true, system: true },
		});
		const tempCombined = path.join(session.tempDir, "combined.m4a");
		const remapped = remapListenFilesToFinalDir(session, {
			mic: path.join(session.tempDir, "mic.wav"),
			system: path.join(session.tempDir, "system.wav"),
			combined: tempCombined,
		});

		expect(remapped.mic).toBe(path.join(session.finalDir, "mic.wav"));
		expect(remapped.system).toBe(path.join(session.finalDir, "system.wav"));
		expect(remapped.combined).toBe(path.join(session.finalDir, "combined.m4a"));
	});

	it("adds transcript files to recording metadata", () => {
		const metadata = buildListenMetadata({
			session: prepareListenSession({
				recordingsDir: tempDir(),
				id: "transcribed",
				sources: { mic: true, system: true },
			}),
			files: { combined: "combined.m4a" },
		});

		const next = applyTranscriptFilesToMetadata(metadata, {
			transcript: "transcript.txt",
			transcriptJson: "transcript.json",
		});

		expect(next.files).toEqual({
			combined: "combined.m4a",
			transcript: "transcript.txt",
			transcriptJson: "transcript.json",
		});
	});
});

describe("audio helper events", () => {
	it("parses supported JSON lines", () => {
		expect(
			parseAudioHelperEvent(
				'{"type":"permission","service":"microphone","status":"granted"}',
			),
		).toEqual({
			type: "permission",
			service: "microphone",
			status: "granted",
		});
	});

	it("parses combined output file events", () => {
		expect(
			parseAudioHelperEvent(
				'{"type":"stopped","files":{"mic":"mic.wav","system":"system.wav","combined":"combined.m4a"}}',
			),
		).toEqual({
			type: "stopped",
			files: {
				mic: "mic.wav",
				system: "system.wav",
				combined: "combined.m4a",
			},
		});
	});

	it("parses transcribed helper events", () => {
		expect(
			parseAudioHelperEvent(
				'{"type":"transcribed","files":{"transcript":"transcript.txt","transcriptJson":"transcript.json"}}',
			),
		).toEqual({
			type: "transcribed",
			files: {
				transcript: "transcript.txt",
				transcriptJson: "transcript.json",
			},
		});
	});

	it("parses standalone combined output file events", () => {
		expect(
			parseAudioHelperEvent(
				'{"type":"combined","files":{"combined":"combined.m4a"}}',
			),
		).toEqual({
			type: "combined",
			files: {
				combined: "combined.m4a",
			},
		});
	});

	it("ignores malformed lines", () => {
		expect(parseAudioHelperEvent("not json")).toBeNull();
		expect(parseAudioHelperEvent('{"type":"unknown"}')).toBeNull();
	});

	it("prefers explicit helper paths", () => {
		expect(resolveAudioHelperPath("/tmp/toby-audio-helper")).toBe(
			"/tmp/toby-audio-helper",
		);
	});

	it("waits for helper exit without a default timeout", async () => {
		vi.useFakeTimers();
		try {
			const child = fakeHelperChild();
			let resolved = false;
			const wait = waitForAudioHelperExit(child).then(() => {
				resolved = true;
			});

			vi.advanceTimersByTime(6_000);

			expect(child.kill).not.toHaveBeenCalled();
			expect(resolved).toBe(false);

			child.exitCode = 0;
			child.emit("exit", 0, null);
			await wait;

			expect(resolved).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it("kills the helper when an explicit timeout is provided", async () => {
		vi.useFakeTimers();
		try {
			const child = fakeHelperChild();
			const wait = waitForAudioHelperExit(child, 5_000);

			vi.advanceTimersByTime(5_000);
			await wait;

			expect(child.kill).toHaveBeenCalledWith("SIGTERM");
			expect(child.killed).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});
});
