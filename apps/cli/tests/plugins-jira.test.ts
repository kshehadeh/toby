import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCredentials, writeCredentials } from "@toby/core/config/index";
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
	pluginToolsList,
} from "@toby/core/integrations/plugins/client";
import { migrateLegacyPluginCredentials } from "@toby/core/integrations/plugins/migrate";
import { resetPluginModuleCache } from "@toby/core/integrations/plugins/registry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const pluginPackageDir = path.join(repoRoot, "../plugin-jira");

function resolveBuiltPluginBinary(): string {
	const distBin = path.join(repoRoot, "../../dist/toby-plugin-jira");
	const releaseBin = path.join(
		pluginPackageDir,
		".build/release/toby-plugin-jira",
	);
	if (fs.existsSync(distBin)) return distBin;
	if (fs.existsSync(releaseBin)) return releaseBin;
	execSync("swift build -c release", { cwd: pluginPackageDir, stdio: "pipe" });
	return releaseBin;
}

function installJiraPlugin(pluginDir: string): string {
	fs.mkdirSync(pluginDir, { recursive: true });
	const source = resolveBuiltPluginBinary();
	const dest = path.join(pluginDir, "toby-plugin-jira");
	fs.copyFileSync(source, dest);
	fs.chmodSync(dest, 0o755);
	return dest;
}

describe("jira plugin", () => {
	let tempDir: string;
	let pluginDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-jira-plugin-"));
		pluginDir = path.join(tempDir, "toby-home", "plugins");
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = path.join(tempDir, "toby-home");
		resetPluginModuleCache();
		installJiraPlugin(pluginDir);
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
		expect(isBuiltinIntegration("jira")).toBe(false);
	});

	it("returns jira identity and chatModelPrep from status", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-jira");
		const status = pluginStatus(binaryPath, {
			config: {
				domain: "acme",
				email: "user@example.com",
				apiToken: "token",
			},
		});
		expect(status.ok).toBe(true);
		if (!status.ok) return;
		expect(status.data.name).toBe("jira");
		expect(status.data.displayName).toBe("Jira");
		expect(status.data.providerCategories).toEqual(["work_tracker"]);
		expect(status.data.resources).toEqual(["issues", "projects"]);
		expect(status.data.chatModelPrep?.systemPromptSection).toContain("Jira");
		expect(status.data.chatReadiness?.ok).toBe(true);
	});

	it("reports chatReadiness hint when credentials are missing", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-jira");
		const status = pluginStatus(binaryPath);
		expect(status.ok).toBe(true);
		if (!status.ok) return;
		expect(status.data.chatReadiness?.ok).toBe(false);
		expect(status.data.chatReadiness?.hint).toContain("toby configure");
	});

	it("maps jira credential fields in config shape", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-jira");
		const shape = pluginConfigShape(binaryPath);
		expect(shape.ok).toBe(true);
		if (!shape.ok || !shape.data.fields) return;

		const keys = shape.data.fields.map((f) => f.key);
		expect(keys).toEqual(["domain", "email", "apiToken"]);
		expect(shape.data.fields.find((f) => f.key === "apiToken")?.masked).toBe(
			true,
		);
	});

	it("lists four jira chat tools", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-jira");
		const list = pluginToolsList(binaryPath);
		expect(list.ok).toBe(true);
		if (!list.ok || !list.data.tools) return;
		expect(list.data.tools.map((t) => t.name)).toEqual([
			"searchJiraIssues",
			"getJiraIssue",
			"getJiraIssueComments",
			"listJiraProjects",
		]);
	});

	it("connect fails without credentials", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-jira");
		const result = pluginConnect(binaryPath, { config: {} });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.ok).toBe(false);
		expect(result.data.reason).toContain("credentials");
	});

	it("registers plugin-backed jira module with chatModelPrep", () => {
		const metadata = loadPluginMetadata({
			binaryPath: path.join(pluginDir, "toby-plugin-jira"),
			binaryName: "toby-plugin-jira",
		});
		expect("error" in metadata).toBe(false);
		if ("error" in metadata) return;

		const module = createPluginIntegrationModule(metadata);
		expect(module.name).toBe("jira");
		expect(module.chatModelPrep?.systemPromptSection).toContain("Jira");
		expect(module.providerCategories).toEqual(["work_tracker"]);
	});

	it("maps credential descriptors to jira.<field> configure keys", () => {
		const metadata = loadPluginMetadata({
			binaryPath: path.join(pluginDir, "toby-plugin-jira"),
			binaryName: "toby-plugin-jira",
		});
		expect("error" in metadata).toBe(false);
		if ("error" in metadata) return;

		const module = createPluginIntegrationModule(metadata);
		const keys = module.getCredentialDescriptors().map((d) => d.key);
		expect(keys).toEqual(["jira.domain", "jira.email", "jira.apiToken"]);
	});

	it("persists configure values under integrations.jira with local keys", () => {
		const creds = buildCredentialsFromValues(
			{
				"jira.domain": "acme",
				"jira.email": "user@example.com",
				"jira.apiToken": "token",
			},
			{},
		);
		expect(creds.integrations?.jira).toEqual({
			domain: "acme",
			email: "user@example.com",
			apiToken: "token",
		});
	});

	it("migrates prefixed jira credential keys inside integrations.jira", () => {
		writeCredentials({
			integrations: {
				jira: {
					"jira.domain": "acme",
					"jira.email": "user@example.com",
					"jira.apiToken": "legacy-token",
				},
			},
		});
		migrateLegacyPluginCredentials();
		const creds = readCredentials();
		expect(creds.integrations?.jira).toEqual({
			domain: "acme",
			email: "user@example.com",
			apiToken: "legacy-token",
		});
	});

	it("migrates legacy top-level jira credentials", () => {
		writeCredentials({
			jira: {
				domain: "acme",
				email: "user@example.com",
				apiToken: "legacy-token",
			},
		});
		migrateLegacyPluginCredentials();
		const creds = readCredentials();
		expect(creds.integrations?.jira?.domain).toBe("acme");
		expect(creds.integrations?.jira?.email).toBe("user@example.com");
		expect(creds.integrations?.jira?.apiToken).toBe("legacy-token");
	});

	it("discovers jira via integration registry when plugin is installed", () => {
		const jira = getIntegrationModule("jira");
		expect(jira).toBeDefined();
		expect(jira?.displayName).toBe("Jira");
	});

	it("getModulesForCategory(work_tracker) includes jira", () => {
		const names = getModulesForCategory("work_tracker").map((m) => m.name);
		expect(names).toContain("jira");
	});
});
