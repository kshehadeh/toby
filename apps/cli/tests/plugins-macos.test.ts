import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	getIntegrationModule,
	isBuiltinIntegration,
} from "@toby/core/integrations/index";
import {
	createPluginIntegrationModule,
	loadPluginMetadata,
} from "@toby/core/integrations/plugins/adapter";
import {
	pluginConfigShape,
	pluginSetup,
	pluginStatus,
	pluginToolsList,
} from "@toby/core/integrations/plugins/client";
import { resetPluginModuleCache } from "@toby/core/integrations/plugins/registry";
import { runPluginSetup } from "@toby/core/integrations/plugins/setup";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const pluginPackageDir = path.join(repoRoot, "../plugin-macos");

function resolveBuiltPluginBinary(): string {
	const distBin = path.join(repoRoot, "../../dist/toby-plugin-macos");
	const releaseBin = path.join(
		pluginPackageDir,
		".build/release/toby-plugin-macos",
	);
	if (fs.existsSync(distBin)) return distBin;
	if (fs.existsSync(releaseBin)) return releaseBin;
	execSync("swift build -c release", { cwd: pluginPackageDir, stdio: "pipe" });
	return releaseBin;
}

function installMacOSPlugin(pluginDir: string): string {
	fs.mkdirSync(pluginDir, { recursive: true });
	const source = resolveBuiltPluginBinary();
	const dest = path.join(pluginDir, "toby-plugin-macos");
	fs.copyFileSync(source, dest);
	fs.chmodSync(dest, 0o755);

	const sourceDir = path.dirname(source);
	const bundleName = "TobyPluginMacOS_TobyPluginMacOSLib.bundle";
	const sourceBundle = path.join(sourceDir, bundleName);
	if (fs.existsSync(sourceBundle)) {
		fs.cpSync(sourceBundle, path.join(pluginDir, bundleName), {
			recursive: true,
		});
	}

	return dest;
}

describe("macos plugin", () => {
	let tempDir: string;
	let pluginDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-macos-plugin-"));
		pluginDir = path.join(tempDir, "toby-home", "plugins");
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = path.join(tempDir, "toby-home");
		resetPluginModuleCache();
		installMacOSPlugin(pluginDir);
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

	it("is not a built-in integration", () => {
		expect(isBuiltinIntegration("macos")).toBe(false);
	});

	it("returns macos identity and chatModelPrep from status", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-macos");
		const status = pluginStatus(binaryPath, {
			state: { connectedAt: "2026-01-01T00:00:00.000Z" },
		});
		expect(status.ok).toBe(true);
		if (!status.ok) return;
		expect(status.data.name).toBe("macos");
		expect(status.data.displayName).toBe("macOS");
		expect(status.data.resources).toEqual(
			expect.arrayContaining(["wifi", "bluetooth", "battery"]),
		);
		expect(status.data.chatModelPrep?.systemPromptSection).toContain(
			"Local macOS",
		);
		expect(status.data.chatReadiness?.ok).toBe(true);

		const disconnected = pluginStatus(binaryPath, {});
		expect(disconnected.ok).toBe(true);
		if (!disconnected.ok) return;
		expect(disconnected.data.chatReadiness?.hint).toContain(
			"toby connect macos",
		);
	});

	it("returns empty config shape", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-macos");
		const shape = pluginConfigShape(binaryPath);
		expect(shape.ok).toBe(true);
		if (!shape.ok) return;
		expect(shape.data.fields ?? []).toEqual([]);
	});

	it("lists twenty-eight macOS chat tools including macFocusSet and window controls", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-macos");
		const list = pluginToolsList(binaryPath);
		expect(list.ok).toBe(true);
		if (!list.ok || !list.data.tools) return;
		const names = list.data.tools.map((t) => t.name);
		expect(names).toContain("macBluetoothStatus");
		expect(names).toContain("macFocusSet");
		expect(names).toContain("macWifiStatus");
		expect(names).toContain("macNotificationsPeek");
		expect(names).toContain("macWindowsHideAll");
		expect(names).toContain("macWindowsShowAll");
		expect(names).toContain("macWindowsMinimizeAll");
		expect(names).toContain("macWindowsUnminimizeAll");
		expect(names).toContain("macWindowHideApp");
		expect(names).toContain("macWindowMinimizeApp");
		expect(names).toContain("macWindowUnminimizeApp");
		expect(names.length).toBe(28);
	});

	it("registers plugin-backed macos module with chatModelPrep", () => {
		const metadata = loadPluginMetadata({
			binaryPath: path.join(pluginDir, "toby-plugin-macos"),
			binaryName: "toby-plugin-macos",
		});
		expect("error" in metadata).toBe(false);
		if ("error" in metadata) return;

		const module = createPluginIntegrationModule(metadata);
		expect(module.name).toBe("macos");
		expect(module.chatModelPrep?.systemPromptSection).toContain("mac*");
		expect(module.resources).toEqual(
			expect.arrayContaining(["wifi", "clipboard"]),
		);
	});

	it("discovers macos via integration registry when plugin is installed", () => {
		const macos = getIntegrationModule("macos");
		expect(macos).toBeDefined();
		expect(macos?.displayName).toBe("macOS");
		expect(macos?.capabilities).toContain("chat");
	});

	it("advertises setup on status and returns bundled shortcut actions", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-macos");
		const status = pluginStatus(binaryPath);
		expect(status.ok).toBe(true);
		if (!status.ok) return;
		expect(status.data.setupAvailable).toBe(true);
		expect(status.data.setupDescription).toContain("Focus shortcuts");

		const setup = pluginSetup(binaryPath);
		expect(setup.ok).toBe(true);
		if (!setup.ok) return;
		expect(setup.data.ok).toBe(true);
		expect(setup.data.actions?.length).toBe(3);
		expect(setup.data.actions?.every((action) => action.ok)).toBe(true);
		const ids = setup.data.actions?.map((a) => a.id) ?? [];
		expect(ids).toContain("accessibility-permission");

		const run = runPluginSetup("macos");
		expect(run.ok).toBe(true);
	});
});
