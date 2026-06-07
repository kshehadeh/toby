import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { waitForProcessExit } from "../src/commands/internal-handoff";
import {
	getStagingPaths,
	readStagingManifest,
	removeLegacySiblingHelpers,
	resolveInstallDir,
	resolveInstallTarget,
	resolveListenerInstallTarget,
	resolveMacOSHelperInstallTarget,
	resolveWhisperCliInstallTargetFromUpgrade,
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
		expect(paths.whisperCliPath).toBe(
			path.join(tempDir, "staging", "whisper-cli"),
		);
		expect(paths.pluginSamplePath).toBe(
			path.join(tempDir, "staging", "toby-plugin-sample"),
		);
		expect(paths.pluginAzureadPath).toBe(
			path.join(tempDir, "staging", "toby-plugin-azuread"),
		);
		expect(paths.pluginGmailPath).toBe(
			path.join(tempDir, "staging", "toby-plugin-gmail"),
		);
		expect(paths.pluginApplemailPath).toBe(
			path.join(tempDir, "staging", "toby-plugin-applemail"),
		);
		expect(paths.webPath).toBe(path.join(tempDir, "staging", "web"));
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

	it("installs helper binaries under ~/.toby/helpers, not the bin dir", () => {
		expect(resolveListenerInstallTarget()).toBe(
			path.join(tempDir, "helpers", "toby-listener"),
		);
		expect(resolveMacOSHelperInstallTarget()).toBe(
			path.join(tempDir, "helpers", "toby-macos"),
		);
		expect(resolveWhisperCliInstallTargetFromUpgrade()).toBe(
			path.join(tempDir, "helpers", "whisper-cli"),
		);
	});
});

describe("removeLegacySiblingHelpers", () => {
	let binDir: string;

	beforeEach(() => {
		binDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-bin-"));
	});

	afterEach(() => {
		fs.rmSync(binDir, { recursive: true, force: true });
	});

	it("removes stale helper binaries left beside the toby binary", async () => {
		const installTarget = path.join(binDir, "toby");
		fs.writeFileSync(installTarget, "binary");
		const staleListener = path.join(binDir, "toby-listener");
		const staleMacOS = path.join(binDir, "toby-macos");
		fs.writeFileSync(staleListener, "old");
		fs.writeFileSync(staleMacOS, "old");

		await removeLegacySiblingHelpers(installTarget, [
			path.join(binDir, "..", "helpers", "toby-listener"),
			path.join(binDir, "..", "helpers", "toby-macos"),
		]);

		expect(fs.existsSync(staleListener)).toBe(false);
		expect(fs.existsSync(staleMacOS)).toBe(false);
		expect(fs.existsSync(installTarget)).toBe(true);
	});

	it("never deletes a sibling that is also the new helper target", async () => {
		const installTarget = path.join(binDir, "toby");
		fs.writeFileSync(installTarget, "binary");
		const sibling = path.join(binDir, "toby-listener");
		fs.writeFileSync(sibling, "current");

		await removeLegacySiblingHelpers(installTarget, [sibling]);

		expect(fs.existsSync(sibling)).toBe(true);
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
