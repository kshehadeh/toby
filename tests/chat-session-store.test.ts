import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { CoreMessage } from "../src/ai/chat";
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
} from "../src/ui/chat/session-store";

const isBun =
	typeof (globalThis as unknown as { Bun?: unknown }).Bun !== "undefined";
import type { TranscriptEntry } from "../src/ui/chat/types";

function makeTempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-test-"));
	return dir;
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

	it("stores and loads pretreatment cache entries", () => {
		process.env.TOBY_DIR = makeTempDir();
		const key = "toby-pretreat-v1-testkey";
		setPretreatmentCache(key, {
			goal: "Test goal",
			mustDo: ["a"],
			mustNotDo: [],
			assumptions: [],
			openQuestions: [],
			relevantIntegrations: ["gmail"],
		});
		const loaded = getPretreatmentCache(key);
		expect(loaded).not.toBeNull();
		expect(loaded?.goal).toBe("Test goal");
		expect(loaded?.relevantIntegrations).toEqual(["gmail"]);
	});
});
