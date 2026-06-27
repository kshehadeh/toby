import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDaemonLogPath } from "@toby/core/config/index";
import {
	clearDaemonLog,
	daemonLog,
	flushDaemonLogSync,
	formatDaemonLogEntry,
	readDaemonLogTail,
} from "@toby/core/logging/daemon-log";
import { afterEach, describe, expect, it } from "bun:test";

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "toby-daemon-log-"));
}

afterEach(() => {
	const dir = process.env.TOBY_DIR;
	if (dir && fs.existsSync(dir)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
	process.env.TOBY_DIR = undefined;
});

describe("daemon log", () => {
	it("writes JSON lines to daemon.log", () => {
		process.env.TOBY_DIR = makeTempDir();
		daemonLog("info", "inbound", "slack_socket_connected", {
			botUserId: "U123",
		});
		flushDaemonLogSync();

		const logPath = getDaemonLogPath();
		expect(fs.existsSync(logPath)).toBe(true);
		const tail = readDaemonLogTail(5);
		expect(tail.length).toBeGreaterThanOrEqual(1);
		const entry = tail.at(-1);
		expect(entry).toBeDefined();
		expect(entry?.type).toBe("slack_socket_connected");
		expect(entry?.category).toBe("inbound");
		if (entry) {
			expect(formatDaemonLogEntry(entry)).toContain("slack_socket_connected");
		}
	});

	it("clearDaemonLog empties the file", () => {
		process.env.TOBY_DIR = makeTempDir();
		daemonLog("info", "daemon", "test", {});
		flushDaemonLogSync();
		clearDaemonLog();
		expect(readDaemonLogTail(10)).toHaveLength(0);
	});
});
