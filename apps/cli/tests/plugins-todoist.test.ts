import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCredentials, writeCredentials } from "@toby/core/config/index";
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
	pluginConnect,
	pluginStatus,
	pluginToolsList,
} from "@toby/core/integrations/plugins/client";
import { migrateLegacyPluginCredentials } from "@toby/core/integrations/plugins/migrate";
import { resetPluginModuleCache } from "@toby/core/integrations/plugins/registry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const todoistCli = path.join(repoRoot, "../plugin-todoist/src/cli.ts");

function writeTodoistPluginWrapper(pluginDir: string): string {
	fs.mkdirSync(pluginDir, { recursive: true });
	const wrapperPath = path.join(pluginDir, "toby-plugin-todoist");
	const script = `#!/usr/bin/env bash\nexec bun ${JSON.stringify(todoistCli)} "$@"\n`;
	fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
	return wrapperPath;
}

describe("todoist plugin", () => {
	let tempDir: string;
	let pluginDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-todoist-plugin-"));
		pluginDir = path.join(tempDir, "toby-home", "plugins");
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = path.join(tempDir, "toby-home");
		resetPluginModuleCache();
		writeTodoistPluginWrapper(pluginDir);
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
		expect(isBuiltinIntegration("todoist")).toBe(false);
	});

	it("returns todoist identity and chatModelPrep from status", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-todoist");
		const status = pluginStatus(binaryPath, {
			config: { apiKey: "test-key" },
		});
		expect(status.ok).toBe(true);
		if (!status.ok) return;
		expect(status.data.name).toBe("todoist");
		expect(status.data.displayName).toBe("Todoist");
		expect(status.data.providerCategories).toEqual(["tasks"]);
		expect(status.data.chatModelPrep?.systemPromptSection).toContain("Todoist");
		expect(status.data.chatReadiness?.ok).toBe(true);
	});

	it("reports chatReadiness hint when api key is missing", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-todoist");
		const status = pluginStatus(binaryPath);
		expect(status.ok).toBe(true);
		if (!status.ok) return;
		expect(status.data.chatReadiness?.ok).toBe(false);
		expect(status.data.chatReadiness?.hint).toContain("toby configure");
	});

	it("maps todoist.apiKey in config shape", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-todoist");
		const shape = pluginConfigShape(binaryPath);
		expect(shape.ok).toBe(true);
		if (!shape.ok || !shape.data.fields) return;

		const keys = shape.data.fields.map((f) => f.key);
		expect(keys).toEqual(["todoist.apiKey"]);
		expect(
			shape.data.fields.find((f) => f.key === "todoist.apiKey")?.masked,
		).toBe(true);
	});

	it("lists seven todoist chat tools", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-todoist");
		const list = pluginToolsList(binaryPath);
		expect(list.ok).toBe(true);
		if (!list.ok || !list.data.tools) return;
		expect(list.data.tools.map((t) => t.name)).toEqual([
			"fetchOpenTasks",
			"fetchCompletedTasks",
			"listProjectNames",
			"getProjectNameById",
			"completeTask",
			"createTask",
			"updateTask",
		]);
	});

	it("connect fails without api key", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-todoist");
		const result = pluginConnect(binaryPath, { config: {} });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.ok).toBe(false);
		expect(result.data.reason).toContain("API key");
	});

	it("registers plugin-backed todoist module with chatModelPrep", () => {
		const metadata = loadPluginMetadata({
			binaryPath: path.join(pluginDir, "toby-plugin-todoist"),
			binaryName: "toby-plugin-todoist",
		});
		expect("error" in metadata).toBe(false);
		if ("error" in metadata) return;

		const module = createPluginIntegrationModule(metadata);
		expect(module.name).toBe("todoist");
		expect(module.chatModelPrep?.systemPromptSection).toContain("Todoist");
		expect(module.providerCategories).toEqual(["tasks"]);
	});

	it("migrates legacy top-level todoist credentials", () => {
		writeCredentials({
			todoist: { apiKey: "legacy-key" },
		});
		migrateLegacyPluginCredentials();
		const creds = readCredentials();
		expect(creds.integrations?.todoist?.apiKey).toBe("legacy-key");
	});

	it("discovers todoist via integration registry when plugin is installed", () => {
		const todoist = getIntegrationModule("todoist");
		expect(todoist).toBeDefined();
		expect(todoist?.displayName).toBe("Todoist");
	});
});
