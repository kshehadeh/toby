import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCredentials, writeCredentials } from "@toby/core/config/index";
import { buildCredentialsFromValues } from "@toby/core/configure/persistence";
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
import { discoverPluginBinaries } from "@toby/core/integrations/plugins/discovery";
import { migrateLegacyPluginCredentials } from "@toby/core/integrations/plugins/migrate";
import {
	type DiscoveredPlugin,
	pluginDisplayPath,
} from "@toby/core/integrations/plugins/protocol";
import { resetPluginModuleCache } from "@toby/core/integrations/plugins/registry";
import { resolvePluginTarget } from "@toby/core/integrations/plugins/runtime";
import { validatePluginBinary } from "@toby/core/integrations/plugins/validate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const pluginSourceDir = path.join(repoRoot, "../plugin-todoist");

function copyTodoistPlugin(pluginDir: string): void {
	fs.mkdirSync(pluginDir, { recursive: true });
	const dest = path.join(pluginDir, "toby-plugin-todoist");
	fs.cpSync(pluginSourceDir, dest, {
		recursive: true,
		filter: (src) => !src.includes(".turbo") && !src.includes(".build"),
	});
}

function findTodoistPlugin(pluginDir: string): DiscoveredPlugin {
	const discovered = discoverPluginBinaries();
	const found = discovered.find((d) => d.binaryName === "toby-plugin-todoist");
	expect(found).toBeDefined();
	if (!found) throw new Error("toby-plugin-todoist not discovered");
	return found;
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
		copyTodoistPlugin(pluginDir);
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

	it("is discovered as a bun-package plugin", () => {
		const found = findTodoistPlugin(pluginDir);
		expect(found.kind).toBe("bun-package");
	});

	it("returns todoist identity and chatModelPrep from status", () => {
		const found = findTodoistPlugin(pluginDir);
		const target = resolvePluginTarget(found);
		const status = pluginStatus(target, {
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
		const found = findTodoistPlugin(pluginDir);
		const target = resolvePluginTarget(found);
		const status = pluginStatus(target);
		expect(status.ok).toBe(true);
		if (!status.ok) return;
		expect(status.data.chatReadiness?.ok).toBe(false);
		expect(status.data.chatReadiness?.hint).toContain("toby configure");
	});

	it("uses local apiKey in config shape", () => {
		const found = findTodoistPlugin(pluginDir);
		const target = resolvePluginTarget(found);
		const shape = pluginConfigShape(target);
		expect(shape.ok).toBe(true);
		if (!shape.ok || !shape.data.fields) return;

		const keys = shape.data.fields.map((f) => f.key);
		expect(keys).toEqual(["apiKey"]);
		expect(shape.data.fields.find((f) => f.key === "apiKey")?.masked).toBe(
			true,
		);
	});

	it("persists configure values under integrations.todoist with local keys", () => {
		const creds = buildCredentialsFromValues(
			{ "todoist.apiKey": "secret" },
			{},
		);
		expect(creds.integrations?.todoist).toEqual({ apiKey: "secret" });
	});

	it("lists seven todoist chat tools", () => {
		const found = findTodoistPlugin(pluginDir);
		const target = resolvePluginTarget(found);
		const list = pluginToolsList(target);
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
		const found = findTodoistPlugin(pluginDir);
		const target = resolvePluginTarget(found);
		const result = pluginConnect(target, { config: {} });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.ok).toBe(false);
		expect(result.data.reason).toContain("API key");
	});

	it("registers plugin-backed todoist module with chatModelPrep", () => {
		const found = findTodoistPlugin(pluginDir);
		const metadata = loadPluginMetadata(found);
		expect("error" in metadata).toBe(false);
		if ("error" in metadata) return;

		const module = createPluginIntegrationModule(metadata);
		expect(module.name).toBe("todoist");
		expect(module.chatModelPrep?.systemPromptSection).toContain("Todoist");
		expect(module.providerCategories).toEqual(["tasks"]);
	});

	it("maps credential descriptors to todoist.<field> configure keys", () => {
		const found = findTodoistPlugin(pluginDir);
		const metadata = loadPluginMetadata(found);
		expect("error" in metadata).toBe(false);
		if ("error" in metadata) return;

		const module = createPluginIntegrationModule(metadata);
		const keys = module.getCredentialDescriptors().map((d) => d.key);
		expect(keys).toEqual(["todoist.apiKey"]);
	});

	it("validates with plugin doctor", () => {
		const found = findTodoistPlugin(pluginDir);
		const result = validatePluginBinary(found);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.metadata.name).toBe("todoist");
	});

	it("pluginDisplayPath returns directory path", () => {
		const found = findTodoistPlugin(pluginDir);
		expect(pluginDisplayPath(found)).toBe(
			path.join(pluginDir, "toby-plugin-todoist"),
		);
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
