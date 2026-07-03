import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { CoreMessage } from "@toby/core/ai/chat";
import type { TranscriptEntry } from "@toby/core/chat-pipeline/transcript-types";
import { getChatDbPath } from "@toby/core/config/index";
import {
	appendMessageBatch,
	appendTranscriptBatch,
	closeChatDbForTests,
	createChatSession,
	getPretreatmentCache,
	listChatSessions,
	loadChatSession,
	renameChatSession,
	setPretreatmentCache,
	setSessionContextWindow,
} from "@toby/core/session-store";

const isBun =
	typeof (globalThis as unknown as { Bun?: unknown }).Bun !== "undefined";

function makeTempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-test-"));
	return dir;
}

function createLegacyChatDbWithoutContextWindow(): string {
	const dir = makeTempDir();
	process.env.TOBY_DIR = dir;
	fs.mkdirSync(dir, { recursive: true });
	// biome-ignore lint/suspicious/noExplicitAny: Bun-only sqlite fixture setup
	const { Database } = require("bun:sqlite" as any) as {
		Database: new (
			path: string,
		) => {
			exec: (sql: string) => void;
			close: () => void;
		};
	};
	const db = new Database(getChatDbPath());
	db.exec(`
CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO chat_sessions (id, name, created_at, updated_at)
VALUES ('legacy-context-session', 'Legacy', '2026-07-02T00:00:00.000Z', '2026-07-02T00:00:00.000Z');
`);
	db.close();
	return "legacy-context-session";
}

afterEach(() => {
	closeChatDbForTests();
	const dir = process.env.TOBY_DIR;
	if (dir && fs.existsSync(dir)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
	process.env.TOBY_DIR = undefined;
});

describe.skipIf(!isBun)("chat session store", () => {
	it("creates, appends, loads", () => {
		process.env.TOBY_DIR = makeTempDir();
		const s = createChatSession({ name: "New chat" });

		const msgs: CoreMessage[] = [
			{ role: "system", content: "sys" },
			{ role: "user", content: "hello" },
		];
		const transcript: TranscriptEntry[] = [
			{ kind: "user", text: "hello" },
			{ kind: "assistant", text: "hi" },
		];

		appendMessageBatch(s.id, 0, msgs);
		appendTranscriptBatch(s.id, 0, transcript);

		const loaded = loadChatSession(s.id);
		expect(loaded).not.toBeNull();
		expect(loaded?.name).toBe("New chat");
		expect(loaded?.messages).toEqual(msgs);
		expect(loaded?.transcript).toEqual(transcript);
	});

	it("lists sessions by updated_at desc after touch via append", () => {
		process.env.TOBY_DIR = makeTempDir();
		const a = createChatSession({ name: "A" });
		const b = createChatSession({ name: "B" });

		appendMessageBatch(a.id, 0, [{ role: "user", content: "x" }]);

		const list = listChatSessions(10);
		expect(list.length).toBeGreaterThanOrEqual(2);
		expect(list[0]?.id).toBe(a.id);
		expect(list.map((s) => s.id)).toContain(b.id);
	});

	it("renames a session", () => {
		process.env.TOBY_DIR = makeTempDir();
		const s = createChatSession({ name: "Old" });
		renameChatSession(s.id, "New name");
		const loaded = loadChatSession(s.id);
		expect(loaded?.name).toBe("New name");
	});

	it("stores and loads latest context window state", () => {
		process.env.TOBY_DIR = makeTempDir();
		const s = createChatSession({ name: "Context" });

		setSessionContextWindow(s.id, {
			supported: true,
			contextWindowTokens: 128_000,
			fillPercentage: 42,
		});

		const loaded = loadChatSession(s.id);
		expect(loaded?.contextWindow).toEqual({
			supported: true,
			contextWindowTokens: 128_000,
			fillPercentage: 42,
		});
	});

	it("does not downgrade stored context window fill with incomplete updates", () => {
		process.env.TOBY_DIR = makeTempDir();
		const s = createChatSession({ name: "Context" });

		setSessionContextWindow(s.id, {
			supported: true,
			contextWindowTokens: 128_000,
			fillPercentage: 42,
		});
		setSessionContextWindow(s.id, {
			supported: true,
			contextWindowTokens: 128_000,
		});
		setSessionContextWindow(s.id, undefined);

		expect(loadChatSession(s.id)?.contextWindow).toEqual({
			supported: true,
			contextWindowTokens: 128_000,
			fillPercentage: 42,
		});
	});

	it("adds context window column when writing to an existing legacy database", () => {
		const sessionId = createLegacyChatDbWithoutContextWindow();

		setSessionContextWindow(sessionId, {
			supported: true,
			contextWindowTokens: 128_000,
			fillPercentage: 42,
		});

		expect(loadChatSession(sessionId)?.contextWindow).toEqual({
			supported: true,
			contextWindowTokens: 128_000,
			fillPercentage: 42,
		});
	});

	it("stores and loads pretreatment cache entries", () => {
		process.env.TOBY_DIR = makeTempDir();
		const key = "toby-pretreat-v1-testkey";
		setPretreatmentCache(key, {
			goal: "Test goal",
			mustDo: ["a"],
			mustNotDo: [],
			assumptions: [],
			openQuestions: [],
			relevantIntegrations: ["example"],
			relevantSkills: [],
		});
		const loaded = getPretreatmentCache(key);
		expect(loaded).not.toBeNull();
		expect(loaded?.goal).toBe("Test goal");
		expect(loaded?.relevantIntegrations).toEqual(["example"]);
	});

	it("preserves prior chat messages when appending a follow-up turn", () => {
		process.env.TOBY_DIR = makeTempDir();
		const s = createChatSession({ name: "Multi turn" });
		const firstTurn: CoreMessage[] = [
			{ role: "system", content: "sys" },
			{ role: "user", content: "remember pineapple" },
			{ role: "assistant", content: "I will remember pineapple." },
		];
		appendMessageBatch(s.id, 0, firstTurn);

		const loaded = loadChatSession(s.id);
		expect(loaded?.messages).toEqual(firstTurn);

		appendMessageBatch(s.id, firstTurn.length, [
			{ role: "user", content: "what did I ask you to remember?" },
			{ role: "assistant", content: "pineapple" },
		]);

		expect(loadChatSession(s.id)?.messages).toEqual([
			...firstTurn,
			{ role: "user", content: "what did I ask you to remember?" },
			{ role: "assistant", content: "pineapple" },
		]);
	});
});
