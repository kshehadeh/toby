import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	applyChatEvent,
	shouldPersistChatEventInTranscript,
} from "@toby/core/chat-pipeline/transcript-reducer";
import { listenManager } from "@toby/core/listen/manager";
import { transcribeWithPlugin } from "@toby/core/listen/transcription-plugin";
import {
	buildListenMetadata,
	prepareListenSession,
	saveListenSession,
} from "@toby/core/listen/session-controller";
import { closeChatDbForTests } from "@toby/core/session-store";
import { handleWebRequest } from "@toby/core/web/routes";
import {
	ServerEventLog,
	readServerEventLogTail,
} from "@toby/core/web/server-event-log";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@toby/core/listen/transcription-plugin", () => ({
	transcribeWithPlugin: vi.fn(async ({ outDir }: { outDir: string }) => {
		const fs = await import("node:fs");
		const path = await import("node:path");
		fs.writeFileSync(path.join(outDir, "transcript.txt"), "mock transcript\n");
		return { transcript: "transcript.txt" };
	}),
}));

function canUseBunSqlite(): boolean {
	try {
		// biome-ignore lint/suspicious/noExplicitAny: runtime probe
		require("bun:sqlite" as any);
		return true;
	} catch {
		return false;
	}
}

function withTempTobyDir(run: () => void | Promise<void>): Promise<void> {
	const previous = process.env.TOBY_DIR;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-web-chat-test-"));
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
			fs.rmSync(dir, { recursive: true, force: true });
		});
}

describe("server event log", () => {
	it("appends and reads tail lines", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-event-log-"));
		const previous = process.env.TOBY_DIR;
		process.env.TOBY_DIR = dir;
		try {
			const log = new ServerEventLog();
			log.append("test-line");
			log.beginTurn({
				sessionId: "s1",
				text: "hello",
				url: "http://127.0.0.1:7847/api/sessions/s1/turn",
			});
			log.endTurn();
			const tail = readServerEventLogTail(10);
			expect(tail.some((line) => line.includes("test-line"))).toBe(true);
			expect(tail.some((line) => line.includes("BEGIN TURN"))).toBe(true);
		} finally {
			if (previous === undefined) {
				Reflect.deleteProperty(process.env, "TOBY_DIR");
			} else {
				process.env.TOBY_DIR = previous;
			}
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("transcript reducer", () => {
	it("filters hidden lifecycle events from persistence", () => {
		expect(
			shouldPersistChatEventInTranscript({
				type: "lifecycle_start",
				id: "1",
				seq: 1,
				header: "Sending request to model…",
			}),
		).toBe(false);
		expect(
			shouldPersistChatEventInTranscript({
				type: "tool_call_start",
				blockKey: "b1",
				seq: 2,
				toolName: "webSearch",
				args: { query: "hello" },
			}),
		).toBe(true);
	});

	it("maps tool_call_complete to boxed_step", () => {
		const next = applyChatEvent([], {
			type: "tool_call_complete",
			blockKey: "b1",
			seq: 1,
			toolName: "webSearch",
			args: { query: "test" },
			result: { success: true },
		});
		expect(next).toHaveLength(1);
		expect(next[0]?.kind).toBe("boxed_step");
	});
});

describe("web chat API routes", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		closeChatDbForTests();
	});

	it("handles GET /api/status", async () => {
		await withTempTobyDir(async () => {
			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/status"),
				null,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				version: string;
				persona: string;
				model: string;
			};
			expect(body.version.length).toBeGreaterThan(0);
			expect(body.persona.length).toBeGreaterThan(0);
			expect(body.model.length).toBeGreaterThan(0);
		});
	});

	it.skipIf(!canUseBunSqlite())(
		"handles listen status/start/stop routes",
		async () => {
			await withTempTobyDir(async () => {
				vi.spyOn(listenManager, "start").mockReturnValue({
					status: "recording",
					message: "Recording.",
				});
				vi.spyOn(listenManager, "stop").mockResolvedValue({
					status: "idle",
					message: "Recording saved.",
					outputDir: "/tmp/recording",
					transcript: "hello",
				});

				const status = await handleWebRequest(
					new Request("http://127.0.0.1/api/listen/status"),
					null,
				);
				expect(status.status).toBe(200);

				const start = await handleWebRequest(
					new Request("http://127.0.0.1/api/listen/start", { method: "POST" }),
					null,
				);
				expect(start.status).toBe(200);
				expect((await start.json()) as { status: string }).toMatchObject({
					status: "recording",
				});

				const created = await handleWebRequest(
					new Request("http://127.0.0.1/api/sessions", { method: "POST" }),
					null,
				);
				const { id } = (await created.json()) as { id: string };
				const stop = await handleWebRequest(
					new Request("http://127.0.0.1/api/listen/stop", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({}),
					}),
					null,
				);
				expect(stop.status).toBe(200);
				expect(listenManager.stop).toHaveBeenCalledWith();
				expect(id).toMatch(
					/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
				);
			});
		},
	);

	it.skipIf(!canUseBunSqlite())(
		"maps listen conflicts and inactive stop to HTTP errors",
		async () => {
			await withTempTobyDir(async () => {
				vi.spyOn(listenManager, "start").mockImplementation(() => {
					throw new Error("Already recording.");
				});
				vi.spyOn(listenManager, "stop").mockImplementation(async () => {
					throw new Error("No active recording.");
				});

				const start = await handleWebRequest(
					new Request("http://127.0.0.1/api/listen/start", { method: "POST" }),
					null,
				);
				expect(start.status).toBe(409);

				const stop = await handleWebRequest(
					new Request("http://127.0.0.1/api/listen/stop", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({}),
					}),
					null,
				);
				expect(stop.status).toBe(409);
			});
		},
	);

	it("handles GET /api/personas and /api/skills", async () => {
		await withTempTobyDir(async () => {
			const personas = await handleWebRequest(
				new Request("http://127.0.0.1/api/personas"),
				null,
			);
			expect(personas.status).toBe(200);
			const skills = await handleWebRequest(
				new Request("http://127.0.0.1/api/skills"),
				null,
			);
			expect(skills.status).toBe(200);
		});
	});

	it.skipIf(!canUseBunSqlite())(
		"handles POST /api/sessions with settings",
		async () => {
			await withTempTobyDir(async () => {
				const res = await handleWebRequest(
					new Request("http://127.0.0.1/api/sessions", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							persona: "default",
							bootstrap: true,
						}),
					}),
					null,
				);
				expect(res.status).toBe(201);
				const body = (await res.json()) as {
					id: string;
					name: string;
					settings: { persona?: string };
				};
				expect(body.id).toMatch(
					/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
				);
				expect(body.settings.persona).toBe("default");

				const detail = await handleWebRequest(
					new Request(`http://127.0.0.1/api/sessions/${body.id}`),
					null,
				);
				expect(detail.status).toBe(200);
				const detailBody = (await detail.json()) as {
					settings: { persona?: string };
					messageCount: number;
				};
				expect(detailBody.settings.persona).toBe("default");
			});
		},
	);

	it("lists listen recordings and returns transcript detail", async () => {
		await withTempTobyDir(async () => {
			const recordingsDir = path.join(
				process.env.TOBY_DIR ?? "",
				"listen",
				"recordings",
			);
			const session = prepareListenSession({
				recordingsDir,
				id: "route-recording",
				now: new Date("2026-06-17T10:00:00Z"),
				sources: { mic: true, system: true },
			});
			const outputDir = saveListenSession(
				session,
				buildListenMetadata({
					session,
					stoppedAt: new Date("2026-06-17T10:00:05Z"),
					files: { transcript: "transcript.txt", combined: "combined.m4a" },
				}),
			);
			fs.writeFileSync(
				path.join(outputDir, "transcript.txt"),
				"route transcript\n",
			);
			fs.writeFileSync(path.join(outputDir, "combined.m4a"), "audio");

			const list = await handleWebRequest(
				new Request("http://127.0.0.1/api/listen/recordings"),
				null,
			);
			expect(list.status).toBe(200);
			const listBody = (await list.json()) as {
				recordings: Array<{ id: string; hasTranscript: boolean }>;
			};
			expect(listBody.recordings).toEqual([
				expect.objectContaining({
					id: "route-recording",
					hasTranscript: true,
				}),
			]);

			const detail = await handleWebRequest(
				new Request("http://127.0.0.1/api/listen/recordings/route-recording"),
				null,
			);
			expect(detail.status).toBe(200);
			expect((await detail.json()) as { transcript?: string }).toMatchObject({
				transcript: "route transcript",
			});
		});
	});

	it("transcribes combined listen audio before source tracks", async () => {
		await withTempTobyDir(async () => {
			vi.mocked(transcribeWithPlugin).mockClear();
			const recordingsDir = path.join(
				process.env.TOBY_DIR ?? "",
				"listen",
				"recordings",
			);
			const session = prepareListenSession({
				recordingsDir,
				id: "combined-route-recording",
				now: new Date("2026-06-17T10:00:00Z"),
				sources: { mic: true, system: true },
			});
			const outputDir = saveListenSession(
				session,
				buildListenMetadata({
					session,
					stoppedAt: new Date("2026-06-17T10:00:05Z"),
					files: {
						mic: "mic.wav",
						system: "system.wav",
						combined: "combined.m4a",
					},
				}),
			);
			fs.writeFileSync(path.join(outputDir, "mic.wav"), "mic");
			fs.writeFileSync(path.join(outputDir, "system.wav"), "system");
			fs.writeFileSync(path.join(outputDir, "combined.m4a"), "combined");

			const response = await handleWebRequest(
				new Request(
					"http://127.0.0.1/api/listen/recordings/combined-route-recording/transcribe",
					{ method: "POST" },
				),
				null,
			);

			expect(response.status).toBe(200);
			expect(transcribeWithPlugin).toHaveBeenCalledWith(
				expect.objectContaining({
					input: path.join(outputDir, "combined.m4a"),
					outDir: outputDir,
				}),
			);
		});
	});

	it.skipIf(!canUseBunSqlite())(
		"handles PATCH and DELETE /api/sessions/:id",
		async () => {
			await withTempTobyDir(async () => {
				const created = await handleWebRequest(
					new Request("http://127.0.0.1/api/sessions", { method: "POST" }),
					null,
				);
				const { id } = (await created.json()) as { id: string };
				const patched = await handleWebRequest(
					new Request(`http://127.0.0.1/api/sessions/${id}`, {
						method: "PATCH",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ name: "Renamed chat", dryRun: true }),
					}),
					null,
				);
				expect(patched.status).toBe(200);
				const deleted = await handleWebRequest(
					new Request(`http://127.0.0.1/api/sessions/${id}`, {
						method: "DELETE",
					}),
					null,
				);
				expect(deleted.status).toBe(200);
				const missing = await handleWebRequest(
					new Request(`http://127.0.0.1/api/sessions/${id}`),
					null,
				);
				expect(missing.status).toBe(404);
			});
		},
	);

	it.skipIf(!canUseBunSqlite())(
		"rejects empty POST /api/sessions/:id/turn",
		async () => {
			await withTempTobyDir(async () => {
				const created = await handleWebRequest(
					new Request("http://127.0.0.1/api/sessions", { method: "POST" }),
					null,
				);
				const { id } = (await created.json()) as { id: string };
				const res = await handleWebRequest(
					new Request(`http://127.0.0.1/api/sessions/${id}/turn`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ text: "   " }),
					}),
					null,
				);
				expect(res.status).toBe(400);
			});
		},
	);
});
