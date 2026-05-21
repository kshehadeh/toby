import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it } from "vitest";
import { registerListenCommand } from "../src/commands/listen";
import {
	parseAudioHelperEvent,
	resolveAudioHelperPath,
} from "../src/listen/macos/audio-capture";
import {
	buildListenMetadata,
	deleteListenRecording,
	discardListenSession,
	listListenRecordings,
	metadataPath,
	prepareListenSession,
	saveListenSession,
	updateListenRecordingMetadata,
} from "../src/listen/session-controller";

const tempDirs: string[] = [];

function tempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-listen-test-"));
	tempDirs.push(dir);
	return dir;
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

	it("ignores malformed lines", () => {
		expect(parseAudioHelperEvent("not json")).toBeNull();
		expect(parseAudioHelperEvent('{"type":"unknown"}')).toBeNull();
	});

	it("prefers explicit helper paths", () => {
		expect(resolveAudioHelperPath("/tmp/toby-audio-helper")).toBe(
			"/tmp/toby-audio-helper",
		);
	});
});
