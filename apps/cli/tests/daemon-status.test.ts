import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	parseDaemonLock,
	restartDaemonIfRunning,
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
			process.env.TOBY_DIR = undefined;
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
});
