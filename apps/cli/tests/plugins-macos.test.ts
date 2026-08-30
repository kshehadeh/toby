import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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
	pluginStatus,
	pluginToolsList,
} from "@toby/core/integrations/plugins/client";
import {
	findPluginBinary,
	resetPluginModuleCache,
} from "@toby/core/integrations/plugins/registry";
import { resolvePluginTarget } from "@toby/core/integrations/plugins/runtime";

const repoRoot = path.resolve(import.meta.dirname, "..");
const pluginSourceDir = path.join(repoRoot, "../plugin-macos");

function copyMacOSPlugin(pluginDir: string): void {
	fs.mkdirSync(pluginDir, { recursive: true });
	const dest = path.join(pluginDir, "toby-plugin-macos");
	fs.cpSync(pluginSourceDir, dest, {
		recursive: true,
		filter: (src) =>
			!src.includes(".turbo") &&
			!src.includes(".build") &&
			!src.includes("node_modules"),
	});
}

function findMacOSPlugin() {
	const found = findPluginBinary("macos");
	expect(found).toBeDefined();
	if (!found) throw new Error("toby-plugin-macos not discovered");
	return found;
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
		copyMacOSPlugin(pluginDir);
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
		const found = findMacOSPlugin();
		const target = resolvePluginTarget(found);
		const status = pluginStatus(target, {
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
		// chatReadiness depends on whether Toby.app is running
		expect(typeof status.data.chatReadiness?.ok).toBe("boolean");

		const disconnected = pluginStatus(target, {});
		expect(disconnected.ok).toBe(true);
		if (!disconnected.ok) return;
		expect(disconnected.data.chatReadiness?.ok).toBe(false);
		expect(disconnected.data.chatReadiness?.hint).toBeTruthy();
	});

	it("returns empty config shape", () => {
		const found = findMacOSPlugin();
		const target = resolvePluginTarget(found);
		const shape = pluginConfigShape(target);
		expect(shape.ok).toBe(true);
		if (!shape.ok) return;
		expect(shape.data.fields ?? []).toEqual([]);
	});

	it("lists twenty-nine macOS chat tools including macFocusSet and window controls", () => {
		const found = findMacOSPlugin();
		const target = resolvePluginTarget(found);
		const list = pluginToolsList(target);
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
		expect(names.length).toBe(29);
	});

	it("registers plugin-backed macos module with chatModelPrep", () => {
		const found = findMacOSPlugin();
		const metadata = loadPluginMetadata(found);
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

	it("includes the bundled Focus shortcut setup assets", () => {
		const manifestPath = path.join(
			pluginSourceDir,
			"BundledShortcuts",
			"manifest.json",
		);
		const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
			shortcuts?: readonly { name: string; file: string }[];
		};
		expect(manifest.shortcuts).toHaveLength(2);
		expect(manifest.shortcuts?.map((shortcut) => shortcut.name)).toEqual([
			"TobyFocusOn",
			"TobyFocusOff",
		]);
		for (const shortcut of manifest.shortcuts ?? []) {
			expect(
				fs.existsSync(
					path.join(pluginSourceDir, "BundledShortcuts", shortcut.file),
				),
			).toBe(true);
		}
	});
});
