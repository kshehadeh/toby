import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	spyOn,
	test,
} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as config from "@toby/core/config/index";
import {
	clearUnifiedLog,
	emitLog,
	flushUnifiedLog,
} from "@toby/core/logging/logger";
import { queryUnifiedLog } from "@toby/core/logging/query";
import { handleWebRequest } from "@toby/core/web/routes";

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "toby-logs-api-"));
const LOGS_DIR = path.join(TMP_DIR, "logs");
const LOG_PATH = path.join(LOGS_DIR, "toby.log");

let getUnifiedLogPathSpy: ReturnType<
	typeof spyOn<typeof config, "getUnifiedLogPath">
>;
let ensureLogsDirSpy: ReturnType<typeof spyOn<typeof config, "ensureLogsDir">>;

beforeAll(() => {
	fs.mkdirSync(LOGS_DIR, { recursive: true });
	getUnifiedLogPathSpy = spyOn(config, "getUnifiedLogPath").mockImplementation(
		() => LOG_PATH,
	);
	ensureLogsDirSpy = spyOn(config, "ensureLogsDir").mockImplementation(() => {
		if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
	});
});

afterAll(() => {
	getUnifiedLogPathSpy.mockRestore();
	ensureLogsDirSpy.mockRestore();
	fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

beforeEach(() => {
	clearUnifiedLog();
});

afterEach(() => {
	clearUnifiedLog();
});

function seedLogs() {
	// emitLog drops debug by default — use info+ for seed data.
	emitLog("daemon", "info", "plugin", "poll_complete", { plugin: "email" });
	emitLog("daemon", "error", "plugin", "tool_failed", { error: "timeout" });
	emitLog("chat", "info", "turn", "turn_start", { sessionId: "abc" });
	emitLog("chat", "warn", "model", "slow_response", { ms: 1200 });
	emitLog("native-app", "info", "server", "log", { message: "hello" });
	flushUnifiedLog();
}

describe("queryUnifiedLog", () => {
	test("returns logPath and empty entries when file is empty", () => {
		const result = queryUnifiedLog();
		expect(result.logPath).toBe(LOG_PATH);
		expect(result.entries).toEqual([]);
		expect(result.matched).toBe(0);
		expect(result.hasMore).toBe(false);
	});

	test("filters by source, level, category, type", () => {
		seedLogs();
		const bySource = queryUnifiedLog({ source: "daemon" });
		expect(bySource.matched).toBe(2);
		expect(bySource.entries.every((e) => e.source === "daemon")).toBe(true);

		const byLevel = queryUnifiedLog({ level: "error" });
		expect(byLevel.matched).toBe(1);
		expect(byLevel.entries[0]?.type).toBe("tool_failed");

		const byCategory = queryUnifiedLog({ category: "model" });
		expect(byCategory.matched).toBe(1);
		expect(byCategory.entries[0]?.type).toBe("slow_response");

		const byType = queryUnifiedLog({ type: "poll_complete" });
		expect(byType.matched).toBe(1);
	});

	test("q search matches data fields", () => {
		seedLogs();
		const result = queryUnifiedLog({ q: "timeout" });
		expect(result.matched).toBe(1);
		expect(result.entries[0]?.type).toBe("tool_failed");
	});

	test("limit returns newest-first and hasMore", () => {
		seedLogs();
		const result = queryUnifiedLog({ limit: 2 });
		expect(result.entries).toHaveLength(2);
		expect(result.matched).toBe(5);
		expect(result.hasMore).toBe(true);
		// Newest first: native-app log was last seeded.
		expect(result.entries[0]?.source).toBe("native-app");
	});

	test("facets include sources with counts", () => {
		seedLogs();
		const result = queryUnifiedLog();
		const daemon = result.facets.sources.find((s) => s.name === "daemon");
		const chat = result.facets.sources.find((s) => s.name === "chat");
		expect(daemon?.count).toBe(2);
		expect(chat?.count).toBe(2);
	});
});

describe("GET /api/logs", () => {
	test("returns 200 with logPath and entries", async () => {
		seedLogs();
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/logs"),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			logPath: string;
			entries: unknown[];
			matched: number;
			hasMore: boolean;
			limit: number;
			facets: { sources: { name: string; count: number }[] };
		};
		expect(body.logPath).toBe(LOG_PATH);
		expect(body.matched).toBe(5);
		expect(body.entries).toHaveLength(5);
		expect(body.limit).toBe(100);
		expect(body.facets.sources.length).toBeGreaterThan(0);
	});

	test("respects source and limit query params", async () => {
		seedLogs();
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/logs?source=daemon&limit=1"),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			entries: { source: string }[];
			matched: number;
			hasMore: boolean;
			limit: number;
		};
		expect(body.limit).toBe(1);
		expect(body.matched).toBe(2);
		expect(body.hasMore).toBe(true);
		expect(body.entries).toHaveLength(1);
		expect(body.entries[0]?.source).toBe("daemon");
	});

	test("filters by level and type", async () => {
		seedLogs();
		const res = await handleWebRequest(
			new Request(
				"http://127.0.0.1/api/logs?level=error&type=tool_failed&category=plugin",
			),
		);
		const body = (await res.json()) as {
			matched: number;
			entries: { type: string; level: string }[];
		};
		expect(body.matched).toBe(1);
		expect(body.entries[0]?.level).toBe("error");
		expect(body.entries[0]?.type).toBe("tool_failed");
	});
});
