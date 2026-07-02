import { afterEach, describe, expect, it, jest, mock, spyOn } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	applyChatEvent,
	shouldPersistChatEventInTranscript,
} from "@toby/core/chat-pipeline/transcript-reducer";
import { listenManager } from "@toby/core/listen/manager";
import {
	buildListenMetadata,
	prepareListenSession,
	saveListenSession,
} from "@toby/core/listen/session-controller";
import { transcribeWithModel } from "@toby/core/listen/transcription-model";
import {
	closeChatDbForTests,
	setSessionContextWindow,
} from "@toby/core/session-store";
import { handleWebRequest } from "@toby/core/web/routes";
import {
	ServerEventLog,
	readServerEventLogTail,
} from "@toby/core/web/server-event-log";

mock.module("@toby/core/listen/transcription-model", () => ({
	transcribeWithModel: mock(async ({ outDir }: { outDir: string }) => {
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
		jest.restoreAllMocks();
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
				const originalStart = listenManager.start;
				const originalStop = listenManager.stop;
				listenManager.start = () =>
					({
						status: "recording",
						message: "Recording.",
					}) as never;
				listenManager.stop = () =>
					Promise.resolve({
						status: "idle",
						message: "Recording saved.",
						outputDir: "/tmp/recording",
						transcript: "hello",
					} as never);

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
				expect(id).toMatch(
					/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
				);
				listenManager.start = originalStart;
				listenManager.stop = originalStop;
			});
		},
	);

	it.skipIf(!canUseBunSqlite())(
		"maps listen conflicts and inactive stop to HTTP errors",
		async () => {
			await withTempTobyDir(async () => {
				const originalStart2 = listenManager.start;
				const originalStop2 = listenManager.stop;
				listenManager.start = () => {
					throw new Error("Already recording.");
				};
				listenManager.stop = () => {
					throw new Error("No active recording.");
				};

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
				listenManager.start = originalStart2;
				listenManager.stop = originalStop2;
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
				setSessionContextWindow(body.id, {
					supported: true,
					contextWindowTokens: 128_000,
					fillPercentage: 42,
				});

				const detail = await handleWebRequest(
					new Request(`http://127.0.0.1/api/sessions/${body.id}`),
					null,
				);
				expect(detail.status).toBe(200);
				const detailBody = (await detail.json()) as {
					settings: { persona?: string };
					messageCount: number;
					contextWindow?: {
						supported: boolean;
						contextWindowTokens?: number;
						fillPercentage?: number;
					};
				};
				expect(detailBody.settings.persona).toBe("default");
				expect(detailBody.contextWindow).toEqual({
					supported: true,
					contextWindowTokens: 128_000,
					fillPercentage: 42,
				});
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
			expect(
				(await detail.json()) as { transcript?: string; audioPath?: string },
			).toMatchObject({
				transcript: "route transcript",
				audioPath: path.join(outputDir, "combined.m4a"),
			});
		});
	});

	it("patches listen recording name via PATCH route", async () => {
		await withTempTobyDir(async () => {
			const recordingsDir = path.join(
				process.env.TOBY_DIR ?? "",
				"listen",
				"recordings",
			);
			const session = prepareListenSession({
				recordingsDir,
				id: "patch-route-recording",
				now: new Date("2026-06-17T10:00:00Z"),
				sources: { mic: true, system: true },
			});
			saveListenSession(
				session,
				buildListenMetadata({
					session,
					stoppedAt: new Date("2026-06-17T10:00:05Z"),
					files: {},
				}),
			);

			const patched = await handleWebRequest(
				new Request(
					"http://127.0.0.1/api/listen/recordings/patch-route-recording",
					{
						method: "PATCH",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ name: "Standup" }),
					},
				),
				null,
			);
			expect(patched.status).toBe(200);
			const body = (await patched.json()) as {
				metadata: { name?: string };
			};
			expect(body.metadata.name).toBe("Standup");

			const detail = await handleWebRequest(
				new Request(
					"http://127.0.0.1/api/listen/recordings/patch-route-recording",
				),
				null,
			);
			const detailBody = (await detail.json()) as {
				metadata: { name?: string };
			};
			expect(detailBody.metadata.name).toBe("Standup");
		});
	});

	it("returns 404 when patching a missing recording", async () => {
		await withTempTobyDir(async () => {
			const res = await handleWebRequest(
				new Request(
					"http://127.0.0.1/api/listen/recordings/no-such-recording",
					{
						method: "PATCH",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ name: "Ghost" }),
					},
				),
				null,
			);
			expect(res.status).toBe(404);
		});
	});

	it("deletes listen recordings", async () => {
		await withTempTobyDir(async () => {
			const recordingsDir = path.join(
				process.env.TOBY_DIR ?? "",
				"listen",
				"recordings",
			);
			const session = prepareListenSession({
				recordingsDir,
				id: "delete-route-recording",
				now: new Date("2026-06-17T10:00:00Z"),
				sources: { mic: true, system: true },
			});
			const outputDir = saveListenSession(
				session,
				buildListenMetadata({
					session,
					stoppedAt: new Date("2026-06-17T10:00:05Z"),
					files: {},
				}),
			);

			const deleted = await handleWebRequest(
				new Request(
					"http://127.0.0.1/api/listen/recordings/delete-route-recording",
					{ method: "DELETE" },
				),
				null,
			);
			expect(deleted.status).toBe(200);
			expect(fs.existsSync(outputDir)).toBe(false);

			const missing = await handleWebRequest(
				new Request(
					"http://127.0.0.1/api/listen/recordings/delete-route-recording",
					{ method: "DELETE" },
				),
				null,
			);
			expect(missing.status).toBe(404);
		});
	});

	it("transcribes combined listen audio before source tracks", async () => {
		await withTempTobyDir(async () => {
			(
				transcribeWithModel as unknown as { mockClear?: () => void }
			).mockClear?.();
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
			expect(transcribeWithModel).toHaveBeenCalledWith(
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

const originalFetch = globalThis.fetch;

describe("changelog API", () => {
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("GET /api/releases/changelog returns parsed releases", async () => {
		const fetchMock = mock(() =>
			Promise.resolve({
				ok: true,
				status: 200,
				statusText: "OK",
				json: async () => [
					{
						tag_name: "v0.49.0",
						name: "v0.49.0",
						body: "- feat(app): hide Listen section (a407cf9)\n- fix(app): keep chat title clear (d6f0323)\n- chore(release): v0.49.0",
						html_url: "https://github.com/kshehadeh/toby/releases/tag/v0.49.0",
						published_at: "2026-06-19T09:43:31Z",
					},
				],
			}),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/releases/changelog"),
			null,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			releases: Array<{
				version: string;
				features: Array<{ description: string }>;
				bugs: Array<{ description: string }>;
			}>;
		};
		expect(body.releases).toHaveLength(1);
		expect(body.releases[0]?.version).toBe("v0.49.0");
		expect(body.releases[0]?.features).toHaveLength(1);
		expect(body.releases[0]?.features[0]?.description).toBe(
			"hide Listen section",
		);
		expect(body.releases[0]?.bugs).toHaveLength(1);
		expect(body.releases[0]?.bugs[0]?.description).toBe(
			"keep chat title clear",
		);
	});

	it("GET /api/releases/changelog?limit=5 respects the limit", async () => {
		const fetchMock = mock(() =>
			Promise.resolve({
				ok: true,
				status: 200,
				statusText: "OK",
				json: async () => [],
			}),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		await handleWebRequest(
			new Request("http://127.0.0.1/api/releases/changelog?limit=5"),
			null,
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const callUrl = fetchMock.mock.calls[0]?.[0] as string;
		expect(callUrl).toContain("per_page=5");
	});

	it("GET /api/releases/changelog returns 502 when GitHub is unavailable", async () => {
		const fetchMock = mock(() =>
			Promise.resolve({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
			}),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/releases/changelog"),
			null,
		);
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain("Failed to fetch changelog");
	});
});
