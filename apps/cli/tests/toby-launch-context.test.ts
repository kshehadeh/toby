import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { captureLaunchContext } from "../src/toby-launch-context";

describe("captureLaunchContext", () => {
	const originalArgv = process.argv;

	afterEach(() => {
		process.argv = originalArgv;
	});

	it("maps root -p to chat --prompt for restart args", () => {
		process.argv = ["/usr/local/bin/toby", "-p", "summarize inbox"];
		const ctx = captureLaunchContext(["-p", "summarize inbox"]);
		expect(ctx.args).toEqual(["chat", "--prompt", "summarize inbox"]);
		expect(ctx.compiled).toBe(true);
	});

	it("does not prepend chat for unknown positional tokens", () => {
		process.argv = ["/usr/local/bin/toby", "summarize", "inbox"];
		const ctx = captureLaunchContext(["summarize", "inbox"]);
		expect(ctx.args).toEqual(["summarize", "inbox"]);
	});

	it("preserves explicit chat subcommand and flags", () => {
		process.argv = ["/path/bun", "/proj/src/cli.ts", "chat", "--debug"];
		const ctx = captureLaunchContext(["chat", "--debug"]);
		expect(ctx.args).toEqual(["/proj/src/cli.ts", "chat", "--debug"]);
		expect(ctx.compiled).toBe(false);
	});

	it("preserves other subcommands", () => {
		process.argv = ["/usr/local/bin/toby", "upgrade", "--download-only"];
		const ctx = captureLaunchContext(["upgrade", "--download-only"]);
		expect(ctx.args).toEqual(["upgrade", "--download-only"]);
	});
});

describe("resolveInstallTarget in script mode", () => {
	let tempDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-launch-"));
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

	it("uses install dir when running from script", () => {
		process.argv = ["/path/bun", "/proj/src/cli.ts", "chat"];
		const ctx = captureLaunchContext(["chat"]);
		expect(ctx.installTarget).toContain(
			`${path.sep}.local${path.sep}bin${path.sep}toby`,
		);
	});
});
