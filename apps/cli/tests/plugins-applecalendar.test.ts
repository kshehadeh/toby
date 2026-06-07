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
	pluginStatus,
	pluginToolsList,
} from "@toby/core/integrations/plugins/client";
import { resetPluginModuleCache } from "@toby/core/integrations/plugins/registry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const pluginPackageDir = path.join(repoRoot, "../plugin-applecalendar");

function resolveBuiltPluginBinary(): string {
	const distBin = path.join(repoRoot, "../../dist/toby-plugin-applecalendar");
	const releaseBin = path.join(
		pluginPackageDir,
		".build/release/toby-plugin-applecalendar",
	);
	if (fs.existsSync(distBin)) return distBin;
	if (fs.existsSync(releaseBin)) return releaseBin;
	execSync("swift build -c release", { cwd: pluginPackageDir, stdio: "pipe" });
	return releaseBin;
}

function installAppleCalendarPlugin(pluginDir: string): string {
	fs.mkdirSync(pluginDir, { recursive: true });
	const source = resolveBuiltPluginBinary();
	const dest = path.join(pluginDir, "toby-plugin-applecalendar");
	fs.copyFileSync(source, dest);
	fs.chmodSync(dest, 0o755);
	return dest;
}

describe("applecalendar plugin", () => {
	let tempDir: string;
	let pluginDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "toby-applecalendar-plugin-"),
		);
		pluginDir = path.join(tempDir, "toby-home", "plugins");
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = path.join(tempDir, "toby-home");
		resetPluginModuleCache();
		installAppleCalendarPlugin(pluginDir);
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
		expect(isBuiltinIntegration("applecalendar")).toBe(false);
	});

	it("returns applecalendar identity and chatModelPrep from status", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-applecalendar");
		const status = pluginStatus(binaryPath, {
			state: { connectedAt: "2026-01-01T00:00:00.000Z" },
		});
		expect(status.ok).toBe(true);
		if (!status.ok) return;
		expect(status.data.name).toBe("applecalendar");
		expect(status.data.displayName).toBe("Apple Calendar");
		expect(status.data.providerCategories).toEqual(["calendar"]);
		expect(status.data.chatModelPrep?.systemPromptSection).toContain(
			"Apple Calendar",
		);
		expect(status.data.chatReadiness?.ok).toBe(true);

		const disconnected = pluginStatus(binaryPath, {});
		expect(disconnected.ok).toBe(true);
		if (!disconnected.ok) return;
		expect(disconnected.data.chatReadiness?.hint).toContain(
			"toby connect applecalendar",
		);
	});

	it("returns empty config shape", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-applecalendar");
		const shape = pluginConfigShape(binaryPath);
		expect(shape.ok).toBe(true);
		if (!shape.ok) return;
		expect(shape.data.fields ?? []).toEqual([]);
	});

	it("lists six apple calendar chat tools", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-applecalendar");
		const list = pluginToolsList(binaryPath);
		expect(list.ok).toBe(true);
		if (!list.ok || !list.data.tools) return;
		expect(list.data.tools.map((t) => t.name)).toEqual([
			"listCalendars",
			"searchCalendarEvents",
			"getCalendarEvent",
			"createCalendarEvent",
			"updateCalendarEvent",
			"deleteCalendarEvent",
		]);
	});

	it("registers plugin-backed applecalendar module with chatModelPrep", () => {
		const metadata = loadPluginMetadata({
			binaryPath: path.join(pluginDir, "toby-plugin-applecalendar"),
			binaryName: "toby-plugin-applecalendar",
		});
		expect("error" in metadata).toBe(false);
		if ("error" in metadata) return;

		const module = createPluginIntegrationModule(metadata);
		expect(module.name).toBe("applecalendar");
		expect(module.chatModelPrep?.systemPromptSection).toContain(
			"Apple Calendar",
		);
		expect(module.providerCategories).toEqual(["calendar"]);
	});

	it("discovers applecalendar via integration registry when plugin is installed", () => {
		const applecalendar = getIntegrationModule("applecalendar");
		expect(applecalendar).toBeDefined();
		expect(applecalendar?.displayName).toBe("Apple Calendar");
	});
});
