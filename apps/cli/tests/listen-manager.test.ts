import { afterEach, describe, expect, it, jest, mock, spyOn } from "bun:test";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ListenManager } from "@toby/core/listen/manager";
import { listListenRecordings } from "@toby/core/listen/recordings";
import { closeChatDbForTests } from "@toby/core/session-store";

afterEach(() => {
	jest.restoreAllMocks();
});

const tempDirs: string[] = [];

function tempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-listen-manager-"));
	tempDirs.push(dir);
	return dir;
}

function fakeChild(): ChildProcessWithoutNullStreams {
	const child = new EventEmitter() as EventEmitter & {
		exitCode: number | null;
		killed: boolean;
		kill: ReturnType<typeof mock>;
	};
	child.exitCode = null;
	child.killed = false;
	child.kill = mock(() => {
		child.killed = true;
		child.emit("exit", 0);
		return true;
	});
	return child as unknown as ChildProcessWithoutNullStreams;
}

function withTempTobyDir(run: () => void | Promise<void>): Promise<void> {
	const previous = process.env.TOBY_DIR;
	const dir = tempDir();
	process.env.TOBY_DIR = dir;
	return Promise.resolve()
		.then(run)
		.finally(() => {
			closeChatDbForTests();
			if (previous === undefined) {
				Reflect.deleteProperty(process.env, "TOBY_DIR");
			} else {
				process.env.TOBY_DIR = previous;
			}
		});
}

afterEach(() => {
	closeChatDbForTests();
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("ListenManager", () => {
	it("starts from idle and rejects a second start", () => {
		const recordingsDir = tempDir();
		const manager = new ListenManager({
			startCapture: ({ session, onEvent }) => {
				fs.writeFileSync(path.join(session.tempDir, "combined.m4a"), "audio");
				onEvent?.({
					type: "ready",
					files: { combined: path.join(session.tempDir, "combined.m4a") },
				});
				return {
					helperPath: "/tmp/fake-helper",
					child: fakeChild(),
					stop: mock(async () => {}),
					dispose: mock(),
				};
			},
		});

		const started = manager.start({ recordingsDir });

		expect(started.status).toBe("recording");
		expect(started.session?.sources).toEqual({ mic: true, system: true });
		expect(() => manager.start({ recordingsDir })).toThrow(/Already recording/);
	});

	it("stops, transcribes, and returns transcript text", async () => {
		const recordingsDir = tempDir();
		const manager = new ListenManager({
			startCapture: ({ session, onEvent }) => {
				fs.writeFileSync(path.join(session.tempDir, "combined.m4a"), "audio");
				onEvent?.({
					type: "ready",
					files: { combined: path.join(session.tempDir, "combined.m4a") },
				});
				return {
					helperPath: "/tmp/fake-helper",
					child: fakeChild(),
					stop: mock(async () => {}),
					dispose: mock(),
				};
			},
			waitForExit: mock(async () => {}),
			transcribe: mock(async ({ outDir }) => {
				const transcript = path.join(outDir, "transcript.txt");
				fs.writeFileSync(transcript, "hello from recording\n");
				return { transcript };
			}),
		});
		manager.start({ recordingsDir });

		const stopped = await manager.stop();

		expect(stopped.status).toBe("idle");
		expect(stopped.outputDir).toBeDefined();
		expect(stopped.transcript).toBe("hello from recording");
		expect(
			fs.existsSync(path.join(stopped.outputDir ?? "", "metadata.json")),
		).toBe(true);
	});

	it("keeps saved recordings separate from chat sessions", async () => {
		await withTempTobyDir(async () => {
			const recordingsDir = path.join(process.env.TOBY_DIR ?? "", "recordings");
			const manager = new ListenManager({
				startCapture: ({ session, onEvent }) => {
					fs.writeFileSync(path.join(session.tempDir, "combined.m4a"), "audio");
					onEvent?.({
						type: "ready",
						files: { combined: path.join(session.tempDir, "combined.m4a") },
					});
					return {
						helperPath: "/tmp/fake-helper",
						child: fakeChild(),
						stop: mock(async () => {}),
						dispose: mock(),
					};
				},
				waitForExit: mock(async () => {}),
				transcribe: mock(async ({ outDir }) => {
					const transcript = path.join(outDir, "transcript.txt");
					fs.writeFileSync(transcript, "native transcript\n");
					return { transcript };
				}),
			});
			manager.start({ recordingsDir });

			await manager.stop();

			const recordings = listListenRecordings(recordingsDir);
			expect(recordings).toHaveLength(1);
			expect(recordings[0]?.metadata.files.transcript).toBeDefined();
		});
	});

	it("saves audio metadata when transcription fails", async () => {
		const recordingsDir = tempDir();
		const manager = new ListenManager({
			startCapture: ({ session, onEvent }) => {
				fs.writeFileSync(path.join(session.tempDir, "combined.m4a"), "audio");
				onEvent?.({
					type: "ready",
					files: { combined: path.join(session.tempDir, "combined.m4a") },
				});
				return {
					helperPath: "/tmp/fake-helper",
					child: fakeChild(),
					stop: mock(async () => {}),
					dispose: mock(),
				};
			},
			waitForExit: mock(async () => {}),
			transcribe: mock(async () => {
				throw new Error("transcription unavailable");
			}),
		});
		manager.start({ recordingsDir });

		const stopped = await manager.stop();
		const metadata = JSON.parse(
			fs.readFileSync(
				path.join(stopped.outputDir ?? "", "metadata.json"),
				"utf8",
			),
		) as { errors?: string[] };

		expect(stopped.transcriptionError).toBe("transcription unavailable");
		expect(metadata.errors).toContain("transcription unavailable");
	});
});
