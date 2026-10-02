import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	parseDaemonLock,
	parseMatchingProcessPids,
	releaseDaemonLock,
	restartDaemonIfRunning,
	waitForDaemonRunning,
} from "../src/schedules/daemon-status";

describe("daemon-status lock parsing", () => {
	it("parses legacy lock files with PID only", () => {
		expect(parseDaemonLock("12345")).toEqual({
			pid: 12345,
			intervalSeconds: null,
		});
	});

	it("parses JSON lock files with interval metadata", () => {
		expect(parseDaemonLock('{"pid":12345,"intervalSeconds":15}')).toEqual({
			pid: 12345,
			intervalSeconds: 15,
		});
	});

	it("returns null for invalid lock contents", () => {
		expect(parseDaemonLock("not-a-pid")).toBeNull();
		expect(parseDaemonLock('{"pid":"oops"}')).toBeNull();
	});
});

describe("restartDaemonIfRunning", () => {
	let tempDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-daemon-status-"));
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = tempDir;
	});

	afterEach(() => {
		if (previousTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("is a no-op when no daemon is running", async () => {
		await expect(restartDaemonIfRunning()).resolves.toEqual({
			wasRunning: false,
			restarted: false,
			intervalSeconds: null,
		});
	});

	it("waits beyond orphan cleanup before declaring startup failed", async () => {
		const lockPath = path.join(tempDir, "daemon.lock");
		const timer = setTimeout(() => {
			fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid }));
		}, 3100);
		try {
			expect(await waitForDaemonRunning()).toEqual({
				running: true,
				pid: process.pid,
			});
		} finally {
			clearTimeout(timer);
		}
	}, 6000);

	it("times out when no process acquires the lock", async () => {
		expect(await waitForDaemonRunning(30, 10)).toEqual({
			running: false,
			pid: null,
		});
	});

	it("only releases a lock belonging to the retiring daemon", () => {
		const lockPath = path.join(tempDir, "daemon.lock");
		fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid }));
		releaseDaemonLock(process.pid + 1);
		expect(fs.existsSync(lockPath)).toBe(true);
		releaseDaemonLock(process.pid);
		expect(fs.existsSync(lockPath)).toBe(false);
		releaseDaemonLock(process.pid);
	});
});

describe("stale daemon process discovery", () => {
	it("filters snapshots without signalling live user daemons", () => {
		expect(
			parseMatchingProcessPids(
				[
					"123 bun cli.ts daemon run --interval 60",
					`${process.pid} bun cli.ts daemon run`,
					"456 grep daemon run",
					"789 bun cli.ts daemon start",
				].join("\n"),
				"daemon run",
			),
		).toEqual([123]);
	});
});
