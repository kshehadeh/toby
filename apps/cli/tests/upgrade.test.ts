import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getPluginsDir } from "@toby/core/config/index";
import * as tobySpawn from "@toby/core/toby-spawn";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForProcessExit } from "../src/commands/internal-handoff";
import { resolveUpgradeHandoffSpawn } from "../src/upgrade/handoff-spawn";
import {
	applyStagedRelease,
	applyStagedReleaseDelegated,
	getStagingPaths,
	readStagingManifest,
	removeLegacySiblingHelpers,
	removeOrphanedLegacyMacOSHelper,
	resolveInstallDir,
	resolveInstallTarget,
	resolveListenerInstallTarget,
	resolveStagedBinaryPath,
	shouldDelegateApplyToStagedBinary,
} from "../src/upgrade/index";

const repoRoot = path.resolve(import.meta.dirname, "..");
const cliEntry = path.join(repoRoot, "src/cli.ts");

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
		expect(paths.pluginAzureadPath).toBe(
			path.join(tempDir, "staging", "toby-plugin-azuread"),
		);
		expect(paths.pluginGmailPath).toBe(
			path.join(tempDir, "staging", "toby-plugin-gmail"),
		);
		expect(paths.pluginTodoistPath).toBe(
			path.join(tempDir, "staging", "toby-plugin-todoist"),
		);
		expect(paths.pluginJiraPath).toBe(
			path.join(tempDir, "staging", "toby-plugin-jira"),
		);
		expect(paths.pluginWebsearchPath).toBe(
			path.join(tempDir, "staging", "toby-plugin-websearch"),
		);
		expect(paths.pluginApplecalendarPath).toBe(
			path.join(tempDir, "staging", "toby-plugin-applecalendar"),
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

	it("installs listener helper under ~/.toby/helpers, not the bin dir", () => {
		expect(resolveListenerInstallTarget()).toBe(
			path.join(tempDir, "helpers", "toby-listener"),
		);
	});
});

describe("removeOrphanedLegacyMacOSHelper", () => {
	let tempDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-legacy-macos-"));
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

	it("removes legacy toby-macos helper from ~/.toby/helpers", async () => {
		const helpersDir = path.join(tempDir, "helpers");
		fs.mkdirSync(helpersDir, { recursive: true });
		const legacyPath = path.join(helpersDir, "toby-macos");
		fs.writeFileSync(legacyPath, "legacy");

		await removeOrphanedLegacyMacOSHelper();

		expect(fs.existsSync(legacyPath)).toBe(false);
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

describe("shouldDelegateApplyToStagedBinary", () => {
	let tempDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-delegate-"));
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

	it("returns false when staged binary is missing", () => {
		expect(shouldDelegateApplyToStagedBinary()).toBe(false);
	});

	it("returns false when staged binary is the current executable", () => {
		const stagedPath = resolveStagedBinaryPath();
		fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
		fs.writeFileSync(stagedPath, "#!/bin/sh\necho ok\n", { mode: 0o755 });
		const resolved = fs.realpathSync(stagedPath);
		const previousExecPath = process.execPath;
		Object.defineProperty(process, "execPath", { value: resolved });
		try {
			expect(shouldDelegateApplyToStagedBinary()).toBe(false);
		} finally {
			Object.defineProperty(process, "execPath", { value: previousExecPath });
		}
	});

	it("returns false for non-compiled runs even when staged binary differs", () => {
		const stagedPath = resolveStagedBinaryPath();
		fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
		fs.writeFileSync(stagedPath, "#!/bin/sh\necho ok\n", { mode: 0o755 });
		expect(shouldDelegateApplyToStagedBinary()).toBe(false);
	});

	it("returns true for compiled runs when staged binary differs", () => {
		const compiledSpy = vi
			.spyOn(tobySpawn, "isRunningAsCompiledBinary")
			.mockReturnValue(true);
		const stagedPath = resolveStagedBinaryPath();
		fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
		fs.writeFileSync(stagedPath, "#!/bin/sh\necho ok\n", { mode: 0o755 });
		try {
			expect(shouldDelegateApplyToStagedBinary()).toBe(true);
		} finally {
			compiledSpy.mockRestore();
		}
	});
});

describe("applyStagedRelease", () => {
	let tempDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-apply-staged-"));
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

	it("installs staged plugin binaries into ~/.toby/plugins", async () => {
		const binDir = path.join(tempDir, "bin");
		const installTarget = path.join(binDir, "toby");
		const paths = getStagingPaths();
		fs.mkdirSync(paths.stagingDir, { recursive: true });
		fs.mkdirSync(binDir, { recursive: true });

		const versionScript = `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "9.9.9"; exit 0; fi\nexit 1\n`;
		fs.writeFileSync(paths.binaryPath, versionScript, { mode: 0o755 });
		fs.writeFileSync(paths.listenerPath, "#!/bin/sh\nexit 0\n", {
			mode: 0o755,
		});
		fs.writeFileSync(paths.pluginSamplePath, "#!/bin/sh\necho sample\n", {
			mode: 0o755,
		});

		const manifest = {
			tag: "v9.9.9",
			version: "9.9.9",
			asset: "toby-darwin-arm64.zip",
			repo: "kshehadeh/toby",
			installTarget,
			listenerInstallTarget: path.join(tempDir, "helpers", "toby-listener"),
			completedAt: new Date().toISOString(),
		};
		fs.writeFileSync(paths.manifestPath, JSON.stringify(manifest, null, 2));

		const result = await applyStagedRelease(installTarget);
		expect(result.version).toBe("9.9.9");
		expect(
			fs.existsSync(path.join(getPluginsDir(), "toby-plugin-sample")),
		).toBe(true);
	});
});

describe("applyStagedReleaseDelegated", () => {
	let tempDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-delegated-apply-"));
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

	it("delegates apply-staged to the staged binary wrapper", async () => {
		const compiledSpy = vi
			.spyOn(tobySpawn, "isRunningAsCompiledBinary")
			.mockReturnValue(true);
		const binDir = path.join(tempDir, "bin");
		const installTarget = path.join(binDir, "toby");
		const paths = getStagingPaths();
		fs.mkdirSync(paths.stagingDir, { recursive: true });
		fs.mkdirSync(binDir, { recursive: true });

		fs.writeFileSync(paths.listenerPath, "#!/bin/sh\nexit 0\n", {
			mode: 0o755,
		});
		fs.writeFileSync(paths.pluginSamplePath, "#!/bin/sh\necho sample\n", {
			mode: 0o755,
		});

		const manifest = {
			tag: "v9.9.9",
			version: "9.9.9",
			asset: "toby-darwin-arm64.zip",
			repo: "kshehadeh/toby",
			installTarget,
			listenerInstallTarget: path.join(tempDir, "helpers", "toby-listener"),
			completedAt: new Date().toISOString(),
		};
		fs.writeFileSync(paths.manifestPath, JSON.stringify(manifest, null, 2));

		const stagedWrapper = `#!/usr/bin/env bash\nset -euo pipefail\nif [[ "\${1:-}" == "--version" ]]; then echo "9.9.9"; exit 0; fi\nif [[ "\${1:-}" == "upgrade" && "\${2:-}" == "--apply-staged" ]]; then\n  exec bun ${JSON.stringify(cliEntry)} upgrade --apply-staged "\${@:3}"\nfi\nexit 1\n`;
		fs.writeFileSync(paths.binaryPath, stagedWrapper, { mode: 0o755 });

		try {
			const result = await applyStagedReleaseDelegated(installTarget);
			expect(result.version).toBe("9.9.9");
			expect(
				fs.existsSync(path.join(getPluginsDir(), "toby-plugin-sample")),
			).toBe(true);
		} finally {
			compiledSpy.mockRestore();
		}
	});
});

describe("resolveUpgradeHandoffSpawn", () => {
	let tempDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-handoff-spawn-"));
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

	it("uses the staged binary when applyStaged and staging toby exists", () => {
		const stagedPath = resolveStagedBinaryPath();
		fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
		fs.writeFileSync(stagedPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

		const launchContext = {
			pid: 1234,
			execPath: "/usr/local/bin/toby",
			installTarget: "/usr/local/bin/toby",
			args: ["chat"],
			compiled: true,
		};
		const resolved = resolveUpgradeHandoffSpawn({
			launchContext,
			applyStaged: true,
		});

		expect(resolved.execPath).toBe(stagedPath);
		expect(resolved.args[0]).toBe("internal");
		expect(resolved.args).toContain("--apply-staged");
		expect(resolved.args).not.toContain(cliEntry);
	});

	it("falls back to current executable when staging toby is missing", () => {
		const launchContext = {
			pid: 1234,
			execPath: "/usr/local/bin/toby",
			installTarget: "/usr/local/bin/toby",
			args: ["chat"],
			compiled: true,
		};
		const resolved = resolveUpgradeHandoffSpawn({
			launchContext,
			applyStaged: true,
		});

		expect(resolved.execPath).toBe(process.execPath);
	});
});
