import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { waitForProcessExit } from "../src/commands/internal-handoff";
import {
	getStagingPaths,
	readStagingManifest,
	resolveInstallDir,
	resolveInstallTarget,
} from "../src/upgrade/index";

describe("upgrade staging paths", () => {
	let tempDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-upgrade-"));
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

	it("returns staging paths under TOBY_DIR", () => {
		const paths = getStagingPaths();
		expect(paths.stagingDir).toBe(path.join(tempDir, "staging"));
		expect(paths.binaryPath).toBe(path.join(tempDir, "staging", "toby"));
		expect(paths.listenerPath).toBe(
			path.join(tempDir, "staging", "toby-listener"),
		);
		expect(paths.pluginSamplePath).toBe(
			path.join(tempDir, "staging", "toby-plugin-sample"),
		);
		expect(paths.archivePath).toBe(
			path.join(tempDir, "staging", "toby-release.zip"),
		);
		expect(paths.manifestPath).toBe(
			path.join(tempDir, "staging", "manifest.json"),
		);
	});

	it("reads missing manifest as null", async () => {
		await expect(readStagingManifest()).resolves.toBeNull();
	});

	it("resolves default install dir", () => {
		expect(resolveInstallDir()).toBe(
			path.resolve(path.join(os.homedir(), ".local", "bin")),
		);
	});
});

describe("waitForProcessExit", () => {
	it("returns when the watched process exits", async () => {
		const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},50)"], {
			stdio: "ignore",
		});
		await expect(
			waitForProcessExit(child.pid ?? 0, 5_000),
		).resolves.toBeUndefined();
	});
});

describe("resolveInstallTarget compiled", () => {
	const originalArgv = process.argv;

	afterEach(() => {
		process.argv = originalArgv;
	});

	it("uses execPath for compiled binaries", () => {
		process.argv = ["/usr/local/bin/toby", "chat"];
		expect(resolveInstallTarget()).toBe(process.execPath);
	});
});
