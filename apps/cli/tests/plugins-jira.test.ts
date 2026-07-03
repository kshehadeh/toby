import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	readConfig,
	readCredentials,
	writeConfig,
	writeCredentials,
} from "@toby/core/config/index";
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
	pluginSetupGuide,
	pluginStatus,
	pluginToolsList,
} from "@toby/core/integrations/plugins/client";
import { collectPluginListEntries } from "@toby/core/integrations/plugins/list-status";
import { migrateLegacyPluginCredentials } from "@toby/core/integrations/plugins/migrate";
import { resetPluginModuleCache } from "@toby/core/integrations/plugins/registry";

const repoRoot = path.resolve(import.meta.dirname, "..");
const jiraEntry = path.join(repoRoot, "../plugin-jira/src/index.ts");

function writeJiraPluginWrapper(pluginDir: string): string {
	fs.mkdirSync(pluginDir, { recursive: true });
	const wrapperPath = path.join(pluginDir, "toby-plugin-jira");
	const script = `#!/usr/bin/env bash\nexec bun ${JSON.stringify(jiraEntry)} "$@"\n`;
	fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
	return wrapperPath;
}

describe("jira plugin", () => {
	let tempDir: string;
	let pluginDir: string;
	let previousTobyDir: string | undefined;
	let previousPluginsDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-jira-plugin-"));
		pluginDir = path.join(tempDir, "toby-home", "plugins");
		previousTobyDir = process.env.TOBY_DIR;
		previousPluginsDir = process.env.TOBY_PLUGINS_DIR;
		process.env.TOBY_DIR = path.join(tempDir, "toby-home");
		process.env.TOBY_PLUGINS_DIR = pluginDir;
		resetPluginModuleCache();
		writeJiraPluginWrapper(pluginDir);
	});

	afterEach(() => {
		if (previousTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		if (previousPluginsDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_PLUGINS_DIR");
		} else {
			process.env.TOBY_PLUGINS_DIR = previousPluginsDir;
		}
		resetPluginModuleCache();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("is not a built-in integration", () => {
		expect(isBuiltinIntegration("jira")).toBe(false);
	});

	it("returns jira identity, chat capability, and chatModelPrep from status", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-jira");
		const status = pluginStatus(binaryPath, {
			config: { clientId: "c", clientSecret: "s" },
		});
		expect(status.ok).toBe(true);
		if (!status.ok) return;
		expect(status.data.name).toBe("jira");
		expect(status.data.capabilities).toContain("chat");
		expect(status.data.providerCategories).toEqual(["work_tracker"]);
		expect(status.data.chatModelPrep?.systemPromptSection).toContain("Jira");
	});

	it("declares oauth and api_token auth methods with oauth as default", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-jira");
		const status = pluginStatus(binaryPath, {});
		expect(status.ok).toBe(true);
		if (!status.ok) return;
		expect(status.data.authMethods?.map((m) => m.id)).toEqual([
			"oauth",
			"api_token",
		]);
		expect(status.data.authMethods?.find((m) => m.isDefault)?.id).toBe("oauth");
	});

	it("lists jira chat tools", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-jira");
		const tools = pluginToolsList(binaryPath);
		expect(tools.ok).toBe(true);
		if (!tools.ok) return;
		const names = (tools.data.tools ?? []).map((t) => t.name).sort();
		expect(names).toEqual([
			"getJiraIssue",
			"getJiraIssueComments",
			"listJiraProjects",
			"searchJiraIssues",
		]);
	});

	it("registers as IntegrationModule with chat capability", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-jira");
		const metadata = loadPluginMetadata({
			kind: "binary",
			binaryPath,
			binaryName: "toby-plugin-jira",
		});
		expect("error" in metadata).toBe(false);
		if ("error" in metadata) return;
		const mod = createPluginIntegrationModule(metadata);
		expect(mod.capabilities).toContain("chat");
	});

	it("appears in integration registry after discovery", () => {
		resetPluginModuleCache();
		const jira = getIntegrationModule("jira");
		expect(jira).toBeDefined();
		expect(jira?.authMethods?.map((m) => m.id)).toEqual(["oauth", "api_token"]);
	});

	it("treats configured API token credentials as connected without connectedAt state", async () => {
		writeConfig({ integrations: { jira: {} } });
		writeCredentials({
			integrations: {
				jira: {
					authMethod: "api_token",
					domain: "acme",
					email: "user@acme.com",
					apiToken: "test-token",
				},
			},
		});

		resetPluginModuleCache();
		const jira = getIntegrationModule("jira");
		expect(jira).toBeDefined();
		expect(await jira?.isConnected()).toBe(true);

		const entries = collectPluginListEntries();
		const jiraEntry = entries.find((entry) => entry.name === "jira");
		expect(jiraEntry?.connected).toBe(true);
	});

	it("treats configured OAuth token as connected without connectedAt state", async () => {
		writeConfig({ integrations: { jira: {} } });
		writeCredentials({
			integrations: {
				jira: {
					authMethod: "oauth",
					clientId: "client-id",
					clientSecret: "client-secret",
					oauthAccessToken: "test-access-token",
					cloudId: "test-cloud-id",
				},
			},
		});

		resetPluginModuleCache();
		const jira = getIntegrationModule("jira");
		expect(jira).toBeDefined();
		expect(await jira?.isConnected()).toBe(true);
	});

	it("config shape includes OAuth and API token fields", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-jira");
		const shape = pluginConfigShape(binaryPath);
		expect(shape.ok).toBe(true);
		if (!shape.ok) return;
		const keys = (shape.data.fields ?? []).map((f) => f.key);
		expect(keys).toContain("clientId");
		expect(keys).toContain("clientSecret");
		expect(keys).toContain("redirectUri");
		expect(keys).toContain("domain");
		expect(keys).toContain("email");
		expect(keys).toContain("apiToken");
	});

	it("credential descriptors are gated by auth method", () => {
		const jira = getIntegrationModule("jira");
		const descriptors = jira?.getCredentialDescriptors() ?? [];
		const oauthKeys = descriptors
			.filter((d) => d.showForAuthMethods?.includes("oauth"))
			.map((d) => d.key);
		const tokenKeys = descriptors
			.filter((d) => d.showForAuthMethods?.includes("api_token"))
			.map((d) => d.key);
		expect(oauthKeys).toContain("jira.clientId");
		expect(oauthKeys).toContain("jira.clientSecret");
		expect(tokenKeys).toContain("jira.domain");
		expect(tokenKeys).toContain("jira.email");
		expect(tokenKeys).toContain("jira.apiToken");
	});

	it("migrates legacy top-level jira credentials", () => {
		writeCredentials({
			jira: {
				domain: "acme",
				email: "user@acme.com",
				apiToken: "legacy-token",
			},
		});
		writeConfig({ integrations: {} });
		migrateLegacyPluginCredentials();
		const creds = readCredentials();
		expect(creds.integrations?.jira?.domain).toBe("acme");
		expect(creds.integrations?.jira?.apiToken).toBe("legacy-token");
		const cfg = readConfig();
		expect(cfg).toBeDefined();
	});

	it("returns a setup guide with redirect URI and scopes", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-jira");
		const guide = pluginSetupGuide(binaryPath);
		expect(guide.ok).toBe(true);
		if (!guide.ok) return;
		expect(guide.data.ok).toBe(true);
		expect(guide.data.name).toBe("jira");
		const steps = guide.data.steps ?? [];
		expect(steps.map((s) => s.id)).toContain("provider");
		const providerStep = steps.find((s) => s.id === "provider");
		expect(providerStep?.artifacts?.some((a) => a.id === "redirectUri")).toBe(
			true,
		);
		expect(providerStep?.artifacts?.some((a) => a.id === "scopes")).toBe(true);
	});

	it("chat readiness hints at OAuth connect when clientId is set but no token", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-jira");
		const status = pluginStatus(binaryPath, {
			config: { clientId: "c", clientSecret: "s" },
		});
		expect(status.ok).toBe(true);
		if (!status.ok) return;
		expect(status.data.chatReadiness?.ok).toBe(false);
		expect(status.data.chatReadiness?.hint).toContain("toby connect jira");
	});
});
