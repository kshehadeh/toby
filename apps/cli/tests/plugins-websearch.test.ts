import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isWebSearchAvailable } from "@toby/core/ai/web-search-global-tools";
import {
	readConfig,
	readCredentials,
	writeCredentials,
} from "@toby/core/config/index";
import { buildCredentialsFromValues } from "@toby/core/configure/persistence";
import {
	getIntegrationModule,
	getModulesForCategory,
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
	pluginToolsExecute,
	pluginToolsList,
} from "@toby/core/integrations/plugins/client";
import { migrateLegacyPluginCredentials } from "@toby/core/integrations/plugins/migrate";
import { resetPluginModuleCache } from "@toby/core/integrations/plugins/registry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const pluginPackageDir = path.join(repoRoot, "../plugin-websearch");

function resolveBuiltPluginBinary(): string {
	const distBin = path.join(repoRoot, "../../dist/toby-plugin-websearch");
	const releaseBin = path.join(
		pluginPackageDir,
		".build/release/toby-plugin-websearch",
	);
	if (fs.existsSync(distBin)) return distBin;
	if (fs.existsSync(releaseBin)) return releaseBin;
	execSync("swift build -c release", { cwd: pluginPackageDir, stdio: "pipe" });
	return releaseBin;
}

function installWebSearchPlugin(pluginDir: string): string {
	fs.mkdirSync(pluginDir, { recursive: true });
	const source = resolveBuiltPluginBinary();
	const dest = path.join(pluginDir, "toby-plugin-websearch");
	fs.copyFileSync(source, dest);
	fs.chmodSync(dest, 0o755);
	return dest;
}

describe("websearch plugin", () => {
	let tempDir: string;
	let pluginDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-websearch-plugin-"));
		pluginDir = path.join(tempDir, "toby-home", "plugins");
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = path.join(tempDir, "toby-home");
		resetPluginModuleCache();
		installWebSearchPlugin(pluginDir);
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
		expect(isBuiltinIntegration("websearch")).toBe(false);
		expect(isBuiltinIntegration("bravesearch")).toBe(false);
	});

	it("returns websearch identity and chatModelPrep from status", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-websearch");
		const status = pluginStatus(binaryPath, {
			config: { apiKey: "test-key" },
		});
		expect(status.ok).toBe(true);
		if (!status.ok) return;
		expect(status.data.name).toBe("websearch");
		expect(status.data.displayName).toBe("Web Search");
		expect(status.data.providerCategories).toEqual(["search"]);
		expect(status.data.resources).toEqual(["web search"]);
		expect(status.data.chatModelPrep?.systemPromptSection).toContain(
			"Web Search",
		);
		expect(status.data.chatReadiness?.ok).toBe(true);
	});

	it("reports chatReadiness hint when API key is missing", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-websearch");
		const status = pluginStatus(binaryPath);
		expect(status.ok).toBe(true);
		if (!status.ok) return;
		expect(status.data.chatReadiness?.ok).toBe(false);
		expect(status.data.chatReadiness?.hint).toContain("toby configure");
	});

	it("uses local apiKey in config shape", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-websearch");
		const shape = pluginConfigShape(binaryPath);
		expect(shape.ok).toBe(true);
		if (!shape.ok || !shape.data.fields) return;

		const keys = shape.data.fields.map((f) => f.key);
		expect(keys).toEqual(["apiKey"]);
		expect(shape.data.fields.find((f) => f.key === "apiKey")?.masked).toBe(
			true,
		);
	});

	it("persists configure values under integrations.websearch with local keys", () => {
		const creds = buildCredentialsFromValues(
			{ "websearch.apiKey": "secret" },
			{},
		);
		expect(creds.integrations?.websearch).toEqual({ apiKey: "secret" });
	});

	it("lists webSearch chat tool", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-websearch");
		const list = pluginToolsList(binaryPath);
		expect(list.ok).toBe(true);
		if (!list.ok || !list.data.tools) return;
		expect(list.data.tools.map((t) => t.name)).toEqual(["webSearch"]);
	});

	it("connect fails without API key", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-websearch");
		const result = pluginConnect(binaryPath, { config: {} });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.ok).toBe(false);
		expect(result.data.reason).toContain("API key");
	});

	it("executes webSearch in dry-run mode", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-websearch");
		const result = pluginToolsExecute(binaryPath, {
			tool: "webSearch",
			input: { query: "hello world" },
			config: { apiKey: "test-key" },
			dryRun: true,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.ok).toBe(true);
		expect(result.data.result).toMatchObject({
			dryRun: true,
			query: "hello world",
		});
	});

	it("registers plugin-backed websearch module with chatModelPrep", () => {
		const metadata = loadPluginMetadata({
			kind: "binary",
			binaryPath: path.join(pluginDir, "toby-plugin-websearch"),
			binaryName: "toby-plugin-websearch",
		});
		expect("error" in metadata).toBe(false);
		if ("error" in metadata) return;

		const module = createPluginIntegrationModule(metadata);
		expect(module.name).toBe("websearch");
		expect(module.chatModelPrep?.systemPromptSection).toContain("Web Search");
		expect(module.providerCategories).toEqual(["search"]);
	});

	it("migrates legacy bravesearch credentials to websearch", () => {
		writeCredentials({
			integrations: {
				bravesearch: { apiKey: "legacy-key" },
			},
		});
		migrateLegacyPluginCredentials();
		const creds = readCredentials();
		expect(creds.integrations?.websearch?.apiKey).toBe("legacy-key");
		expect(creds.integrations?.bravesearch).toBeUndefined();
	});

	it("discovers websearch via integration registry when plugin is installed", () => {
		const websearch = getIntegrationModule("websearch");
		expect(websearch).toBeDefined();
		expect(websearch?.displayName).toBe("Web Search");
	});

	it("getModulesForCategory(search) includes websearch", () => {
		const names = getModulesForCategory("search").map((m) => m.name);
		expect(names).toContain("websearch");
	});

	it("isWebSearchAvailable when plugin installed and API key present", () => {
		writeCredentials({
			integrations: {
				websearch: { apiKey: "test-key" },
			},
		});
		resetPluginModuleCache();
		expect(isWebSearchAvailable()).toBe(true);
	});

	it("isWebSearchAvailable is false without API key", () => {
		writeCredentials({ integrations: {} });
		resetPluginModuleCache();
		expect(isWebSearchAvailable()).toBe(false);
	});

	it("migrates legacy bravesearch connected state to websearch", () => {
		const configPath = path.join(process.env.TOBY_DIR ?? "", "config.json");
		fs.mkdirSync(path.dirname(configPath), { recursive: true });
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				integrations: {
					bravesearch: { connectedAt: "2024-01-01T00:00:00.000Z" },
				},
			}),
			"utf8",
		);
		migrateLegacyPluginCredentials();
		const config = readConfig();
		expect(config.integrations?.websearch?.connectedAt).toBe(
			"2024-01-01T00:00:00.000Z",
		);
		expect(config.integrations?.bravesearch).toBeUndefined();
	});
});
