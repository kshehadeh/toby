import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getUnifiedLogPath } from "@toby/core/config/index";
import {
	clearUnifiedLog,
	emitLog,
	flushUnifiedLogSync,
	getConfiguredLogLevel,
	readUnifiedLogTail,
	shouldEmitLogLevel,
} from "@toby/core/logging/logger";

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "toby-log-level-"));
}

afterEach(() => {
	const dir = process.env.TOBY_DIR;
	if (dir && fs.existsSync(dir)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
	Reflect.deleteProperty(process.env, "TOBY_DIR");
	Reflect.deleteProperty(process.env, "TOBY_LOG_LEVEL");
	Reflect.deleteProperty(process.env, "LOG_LEVEL");
});

describe("unified log level", () => {
	it("defaults to info (suppresses debug)", () => {
		Reflect.deleteProperty(process.env, "TOBY_LOG_LEVEL");
		Reflect.deleteProperty(process.env, "LOG_LEVEL");
		expect(getConfiguredLogLevel()).toBe("info");
		expect(shouldEmitLogLevel("debug")).toBe(false);
		expect(shouldEmitLogLevel("info")).toBe(true);
		expect(shouldEmitLogLevel("warn")).toBe(true);
		expect(shouldEmitLogLevel("error")).toBe(true);
	});

	it("TOBY_LOG_LEVEL=debug enables debug", () => {
		process.env.TOBY_LOG_LEVEL = "debug";
		expect(getConfiguredLogLevel()).toBe("debug");
		expect(shouldEmitLogLevel("debug")).toBe(true);
	});

	it("TOBY_LOG_LEVEL takes precedence over LOG_LEVEL", () => {
		process.env.LOG_LEVEL = "debug";
		process.env.TOBY_LOG_LEVEL = "warn";
		expect(getConfiguredLogLevel()).toBe("warn");
		expect(shouldEmitLogLevel("info")).toBe(false);
		expect(shouldEmitLogLevel("warn")).toBe(true);
	});

	it("falls back to LOG_LEVEL when TOBY_LOG_LEVEL is unset", () => {
		process.env.LOG_LEVEL = "error";
		expect(getConfiguredLogLevel()).toBe("error");
		expect(shouldEmitLogLevel("warn")).toBe(false);
		expect(shouldEmitLogLevel("error")).toBe(true);
	});

	it("accepts warning as alias for warn", () => {
		process.env.TOBY_LOG_LEVEL = "warning";
		expect(getConfiguredLogLevel()).toBe("warn");
	});

	it("ignores invalid values and uses default info", () => {
		process.env.TOBY_LOG_LEVEL = "verbose";
		expect(getConfiguredLogLevel()).toBe("info");
	});

	it("emitLog drops debug by default but writes info+", () => {
		process.env.TOBY_DIR = makeTempDir();
		Reflect.deleteProperty(process.env, "TOBY_LOG_LEVEL");
		Reflect.deleteProperty(process.env, "LOG_LEVEL");

		emitLog("daemon", "debug", "general", "should_skip", { x: 1 });
		emitLog("daemon", "info", "general", "should_keep", { x: 2 });
		emitLog("daemon", "error", "general", "should_keep_error", { x: 3 });
		flushUnifiedLogSync();

		const entries = readUnifiedLogTail(20);
		expect(entries.map((e) => e.type)).toEqual([
			"should_keep",
			"should_keep_error",
		]);
		clearUnifiedLog();
	});

	it("emitLog writes debug when TOBY_LOG_LEVEL=debug", () => {
		process.env.TOBY_DIR = makeTempDir();
		process.env.TOBY_LOG_LEVEL = "debug";

		emitLog("chat", "debug", "tool", "tool_call", { n: 1 });
		flushUnifiedLogSync();

		const entries = readUnifiedLogTail(5);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.type).toBe("tool_call");
		expect(entries[0]?.level).toBe("debug");
		clearUnifiedLog();
	});

	it("does not create log file when only filtered levels are emitted", () => {
		process.env.TOBY_DIR = makeTempDir();
		Reflect.deleteProperty(process.env, "TOBY_LOG_LEVEL");

		emitLog("server", "debug", "server", "sse_raw", { line: "x" });
		flushUnifiedLogSync();

		const logPath = getUnifiedLogPath();
		// File may not exist, or exist but be empty
		if (fs.existsSync(logPath)) {
			expect(fs.readFileSync(logPath, "utf-8").trim()).toBe("");
		}
	});
});
