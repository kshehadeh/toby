import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pluginSetup } from "@toby/core/integrations/plugins/client";
import { installPlugin } from "@toby/core/integrations/plugins/install";
import { resetPluginModuleCache } from "@toby/core/integrations/plugins/registry";
import {
	formatPluginSetupActionLines,
	pluginSetupHasFailures,
	runPluginSetup,
} from "@toby/core/integrations/plugins/setup";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sampleCli = path.join(repoRoot, "../plugin-sample/src/cli.ts");

function writeSamplePluginWrapper(targetPath: string): string {
	fs.mkdirSync(path.dirname(targetPath), { recursive: true });
	const script = `#!/usr/bin/env bash\nexec bun ${JSON.stringify(sampleCli)} "$@"\n`;
	fs.writeFileSync(targetPath, script, { mode: 0o755 });
	return targetPath;
}

describe("plugin setup", () => {
	let tempDir: string;
	let sourceDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-plugin-setup-"));
		sourceDir = path.join(tempDir, "source");
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = path.join(tempDir, "toby-home");
		resetPluginModuleCache();
		fs.mkdirSync(sourceDir, { recursive: true });
	});

	afterEach(() => {
		if (previousTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		resetPluginModuleCache();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("runs setup on an installed plugin and returns action results", () => {
		const sourcePath = writeSamplePluginWrapper(
			path.join(sourceDir, "toby-plugin-sample"),
		);
		installPlugin(sourcePath);

		const result = runPluginSetup("sample");
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}

		expect(result.response.actions).toHaveLength(2);
		expect(result.response.actions?.[0]?.skipped).toBe(true);
		expect(result.response.actions?.[1]?.ok).toBe(true);
		expect(pluginSetupHasFailures(result.response)).toBe(false);
	});

	it("formats setup action lines for CLI output", () => {
		const lines = formatPluginSetupActionLines([
			{
				id: "demo:already-done",
				label: "Demo prerequisite check",
				ok: true,
				skipped: true,
				detail: "Already satisfied.",
			},
		]);
		expect(lines[0]).toContain("Demo prerequisite check");
		expect(lines[0]).toContain("skipped");
	});

	it("reports failure when plugin is not installed", () => {
		const result = runPluginSetup("missing");
		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(result.code).toBe("not_installed");
	});

	it("invokes setup subcommand directly on sample plugin binary", () => {
		const sourcePath = writeSamplePluginWrapper(
			path.join(sourceDir, "toby-plugin-sample"),
		);
		const invoked = pluginSetup(sourcePath);
		expect(invoked.ok).toBe(true);
		if (!invoked.ok) {
			return;
		}
		expect(invoked.data.ok).toBe(true);
		expect(invoked.data.actions?.length).toBeGreaterThan(0);
	});
});
