import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as config from "@toby/core/config/index";

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "toby-log-test-"));
const LOG_PATH = path.join(TMP_DIR, "toby.log");

let getLogPathSpy: ReturnType<typeof spyOn<typeof config, "getLogPath">>;
let ensureTobyDirSpy: ReturnType<typeof spyOn<typeof config, "ensureTobyDir">>;

beforeAll(() => {
	getLogPathSpy = spyOn(config, "getLogPath").mockImplementation(() => LOG_PATH);
	ensureTobyDirSpy = spyOn(config, "ensureTobyDir").mockImplementation(() => {
		if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
	});
});

afterAll(() => {
	getLogPathSpy.mockRestore();
	ensureTobyDirSpy.mockRestore();
	fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

import {
	clearLog,
	flush,
	formatLogEntry,
	log,
	logSessionNote,
	logTurnSummary,
	readLogTail,
} from "@toby/core/logging/chat-log";

beforeEach(() => {
	clearLog();
});

afterEach(() => {
	flush();
	if (fs.existsSync(LOG_PATH)) fs.unlinkSync(LOG_PATH);
});

describe("chat-log", () => {
	test("logSessionNote writes session_note entries", () => {
		logSessionNote("sess-note", "Tools in scope: Gmail (1)");
		flush();
		const entries = readLogTail(1);
		expect(entries[0]?.type).toBe("session_note");
		expect(entries[0]?.category).toBe("session");
		expect(entries[0]?.sessionId).toBe("sess-note");
		expect(entries[0]?.data?.text).toBe("Tools in scope: Gmail (1)");
	});

	test("log writes entries that can be read back", () => {
		log("info", "session", "session_create", { id: "abc123" });
		flush();
		const entries = readLogTail(10);
		expect(entries.length).toBe(1);
		expect(entries[0]?.type).toBe("session_create");
		expect(entries[0]?.category).toBe("session");
		expect(entries[0]?.level).toBe("info");
		expect(entries[0]?.data?.id).toBe("abc123");
	});

	test("readLogTail returns last N entries", () => {
		for (let i = 0; i < 20; i++) {
			log("debug", "tool", "tool_call_start", { index: i });
		}
		flush();
		const entries = readLogTail(5);
		expect(entries.length).toBe(5);
		expect(entries[0]?.data?.index).toBe(15);
		expect(entries[4]?.data?.index).toBe(19);
	});

	test("logTurnSummary writes a turn_summary entry", () => {
		logTurnSummary("sess1", 0, {
			turnIndex: 0,
			durationMs: 1234,
			toolCallCount: 3,
			toolsUsed: ["getInboxUnreadOverview", "fetchOpenTasks", "listLabels"],
			cacheHits: 1,
			cacheMisses: 2,
			inputTokens: 500,
			outputTokens: 100,
			errorCount: 0,
		});
		flush();
		const entries = readLogTail(1);
		expect(entries[0]?.type).toBe("turn_summary");
		expect(entries[0]?.sessionId).toBe("sess1");
		expect(entries[0]?.data?.durationMs).toBe(1234);
		expect(entries[0]?.data?.toolCallCount).toBe(3);
	});

	test("clearLog removes all entries", () => {
		log("info", "general", "test");
		flush();
		clearLog();
		const entries = readLogTail(10);
		expect(entries.length).toBe(0);
	});

	test("truncate long string values in data", () => {
		const longValue = "x".repeat(500);
		log("debug", "tool", "tool_data", { value: longValue });
		flush();
		const entries = readLogTail(1);
		const logged = entries[0]?.data?.value as string;
		expect(logged.length).toBeLessThan(longValue.length);
		expect(logged.endsWith("…")).toBe(true);
	});

	test("formatLogEntry produces compact single-line output", () => {
		const entry = {
			ts: "2026-05-03T12:34:56.789Z",
			level: "info" as const,
			category: "session" as const,
			type: "session_create",
			data: { id: "abc" },
		};
		const formatted = formatLogEntry(entry);
		expect(formatted).toContain("12:34:56");
		expect(formatted).toContain("I session:session_create");
		expect(formatted).toContain("id=");
	});

	test("rotation keeps newest entries when file exceeds max size", () => {
		const origEnv = process.env.TOBY_LOG_MAX_KB;
		// Set very small max size to force rotation
		process.env.TOBY_LOG_MAX_KB = "1"; // 1KB
		// Write enough data to exceed 1KB
		for (let i = 0; i < 100; i++) {
			log("info", "general", "rotation_test", {
				index: i,
				padding: "x".repeat(50),
			});
		}
		flush();
		const content = fs.readFileSync(LOG_PATH, "utf-8");
		const lines = content.split("\n").filter(Boolean);
		// After rotation, should have fewer lines than 100
		expect(lines.length).toBeLessThan(100);
		// The last entry should still be the most recent (index 99)
		const lastLine = lines[lines.length - 1];
		const lastEntry = JSON.parse(lastLine ?? "{}");
		expect(lastEntry.data.index).toBe(99);

		process.env.TOBY_LOG_MAX_KB = origEnv;
	});

	test("buffering flushes after FLUSH_BUFFER_SIZE entries", () => {
		// Write 50 entries (should trigger buffer flush)
		for (let i = 0; i < 50; i++) {
			log("debug", "general", "buffer_test", { index: i });
		}
		// Should be written without explicit flush()
		const entries = readLogTail(50);
		expect(entries.length).toBe(50);
	});
});
