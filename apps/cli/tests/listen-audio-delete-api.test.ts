import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveListenRecordingsDir } from "@toby/core/listen/recordings";
import { handleWebRequest } from "@toby/core/web/routes";

const tempDirs: string[] = [];

function withTempTobyDir(run: () => Promise<void>): Promise<void> {
	const previous = process.env.TOBY_DIR;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-listen-audio-"));
	tempDirs.push(dir);
	process.env.TOBY_DIR = dir;
	return run().finally(() => {
		if (previous === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previous;
		}
		fs.rmSync(dir, { recursive: true, force: true });
	});
}

function seedRecording(id: string): string {
	const recordingDir = path.join(resolveListenRecordingsDir(), id);
	fs.mkdirSync(recordingDir, { recursive: true });
	fs.writeFileSync(path.join(recordingDir, "combined.m4a"), "audio");
	fs.writeFileSync(path.join(recordingDir, "mic.wav"), "mic");
	fs.writeFileSync(path.join(recordingDir, "transcript.txt"), "hello\n");
	fs.writeFileSync(
		path.join(recordingDir, "metadata.json"),
		`${JSON.stringify({
			id,
			createdAt: "2026-09-09T12:00:00Z",
			startedAt: "2026-09-09T12:00:00Z",
			sources: { mic: true, system: false },
			files: {
				combined: "combined.m4a",
				mic: "mic.wav",
				transcript: "transcript.txt",
			},
			platform: "darwin",
		})}\n`,
	);
	return recordingDir;
}

describe("DELETE /api/listen/recordings/:id/audio", () => {
	it("deletes audio files but keeps the recording, transcript, and metadata", async () => {
		await withTempTobyDir(async () => {
			const recordingDir = seedRecording("rec-1");

			const response = await handleWebRequest(
				new Request("http://127.0.0.1/api/listen/recordings/rec-1/audio", {
					method: "DELETE",
				}),
				null,
			);

			expect(response.status).toBe(200);
			const payload = (await response.json()) as {
				hasAudio: boolean;
				hasTranscript: boolean;
				metadata: {
					files: { combined?: string; mic?: string; transcript?: string };
					audioDeletedAt?: string;
				};
			};
			expect(payload.hasAudio).toBe(false);
			expect(payload.hasTranscript).toBe(true);
			expect(fs.existsSync(path.join(recordingDir, "combined.m4a"))).toBe(
				false,
			);
			expect(fs.existsSync(path.join(recordingDir, "mic.wav"))).toBe(false);
			expect(fs.existsSync(path.join(recordingDir, "transcript.txt"))).toBe(
				true,
			);
			expect(payload.metadata.files.combined).toBeUndefined();
			expect(payload.metadata.files.mic).toBeUndefined();
			expect(payload.metadata.files.transcript).toBe("transcript.txt");
			expect(payload.metadata.audioDeletedAt).toBeDefined();
		});
	});

	it("returns 404 for a missing recording", async () => {
		await withTempTobyDir(async () => {
			const response = await handleWebRequest(
				new Request("http://127.0.0.1/api/listen/recordings/missing/audio", {
					method: "DELETE",
				}),
				null,
			);
			expect(response.status).toBe(404);
		});
	});
});
