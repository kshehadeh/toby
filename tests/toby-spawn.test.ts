import { afterEach, describe, expect, it } from "vitest";
import { buildTobySpawnArgs, getTobyEntryScriptArgv } from "../src/toby-spawn";

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
});
