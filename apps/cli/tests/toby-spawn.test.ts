import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	buildTobySpawnArgs,
	getDetachedDaemonSpawnStdio,
	getTobyEntryScriptArgv,
} from "@toby/core/toby-spawn";
import { afterEach, describe, expect, it } from "vitest";

describe("toby-spawn", () => {
	const originalArgv = process.argv;

	afterEach(() => {
		process.argv = originalArgv;
	});

	it("returns null entry script for compiled-binary argv", () => {
		process.argv = ["/usr/local/bin/toby", "daemon", "start"];
		expect(getTobyEntryScriptArgv()).toBeNull();
		expect(buildTobySpawnArgs("daemon", "run")).toEqual(["daemon", "run"]);
	});

	it("includes entry script for bun src/cli.ts", () => {
		process.argv = ["/path/bun", "/proj/src/cli.ts", "daemon", "start"];
		expect(getTobyEntryScriptArgv()).toBe("/proj/src/cli.ts");
		expect(buildTobySpawnArgs("daemon", "run", "--interval", "60")).toEqual([
			"/proj/src/cli.ts",
			"daemon",
			"run",
			"--interval",
			"60",
		]);
	});

	it("includes entry script for linked dist/cli.js", () => {
		process.argv = ["node", "/opt/toby/dist/cli.js", "daemon"];
		expect(getTobyEntryScriptArgv()).toBe("/opt/toby/dist/cli.js");
		expect(buildTobySpawnArgs("daemon", "start")).toEqual([
			"/opt/toby/dist/cli.js",
			"daemon",
			"start",
		]);
	});

	it("opens daemon.log fds for detached spawns (not stdio ignore)", () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-spawn-"));
		const prev = process.env.TOBY_DIR;
		process.env.TOBY_DIR = tmpDir;
		try {
			const stdio = getDetachedDaemonSpawnStdio();
			expect(stdio).toEqual(["ignore", expect.any(Number), expect.any(Number)]);
			expect(fs.existsSync(path.join(tmpDir, "daemon.log"))).toBe(true);
		} finally {
			if (prev === undefined) {
				process.env.TOBY_DIR = undefined;
			} else {
				process.env.TOBY_DIR = prev;
			}
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
