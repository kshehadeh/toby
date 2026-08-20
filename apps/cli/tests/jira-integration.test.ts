import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSettingsTree } from "@toby/core/configure/tree";
import { getIntegrationModule } from "@toby/core/integrations/index";
import { resetPluginModuleCache } from "@toby/core/integrations/plugins/registry";
import { closeChatDbForTests } from "@toby/core/session-store";
import { createJiraPkceChallenge } from "../../plugin-jira/src/auth";
import { getJiraAuthMethod } from "../../plugin-jira/src/config";
import {
	isJiraAccessTokenFresh,
	mergeOAuthTokens,
	parseJiraOAuthExpiry,
} from "../../plugin-jira/src/tokens";
import { TOOL_DEFINITIONS } from "../../plugin-jira/src/tools";

const repoRoot = path.resolve(import.meta.dirname, "..");
const jiraEntry = path.join(repoRoot, "../plugin-jira/src/index.ts");

function writeJiraPluginWrapper(pluginDir: string): void {
	fs.mkdirSync(pluginDir, { recursive: true });
	const wrapperPath = path.join(pluginDir, "toby-plugin-jira");
	const script = `#!/usr/bin/env bash\nexec bun ${JSON.stringify(jiraEntry)} "$@"\n`;
	fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
}

function toBase64Url(value: Buffer): string {
	return value
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

describe("jira plugin helpers", () => {
	it("exposes expected chat tools", () => {
		expect(TOOL_DEFINITIONS.map((t) => t.name).sort()).toEqual([
			"getJiraIssue",
			"getJiraIssueComments",
			"listJiraProjects",
			"searchJiraIssues",
		]);
	});

	it("getJiraAuthMethod returns api_token when domain+apiToken present", () => {
		expect(getJiraAuthMethod({ domain: "acme", apiToken: "token" })).toBe(
			"api_token",
		);
	});

	it("getJiraAuthMethod defaults to oauth without API token", () => {
		expect(getJiraAuthMethod({ clientId: "id" })).toBe("oauth");
	});

	it("getJiraAuthMethod respects explicit authMethod", () => {
		expect(
			getJiraAuthMethod({ domain: "acme", apiToken: "token" }, "oauth"),
		).toBe("oauth");
	});

	it("createJiraPkceChallenge returns verifier and S256 challenge pair", () => {
		const { codeVerifier, codeChallenge } = createJiraPkceChallenge();
		expect(codeVerifier.length).toBeGreaterThan(20);
		expect(codeChallenge).toBe(
			toBase64Url(crypto.createHash("sha256").update(codeVerifier).digest()),
		);
	});

	it("parseJiraOAuthExpiry returns undefined for invalid input", () => {
		expect(parseJiraOAuthExpiry(undefined)).toBeUndefined();
		expect(parseJiraOAuthExpiry(Number.NaN)).toBeUndefined();
	});

	it("parseJiraOAuthExpiry returns ISO string for valid seconds", () => {
		const expiry = parseJiraOAuthExpiry(3600);
		expect(expiry).toBeDefined();
		expect(typeof expiry).toBe("string");
		const ms = Date.parse(expiry as string);
		expect(ms).toBeGreaterThan(Date.now() + 3000_000);
	});

	it("isJiraAccessTokenFresh returns true for missing or invalid expiry", () => {
		expect(isJiraAccessTokenFresh(undefined)).toBe(true);
		expect(isJiraAccessTokenFresh("")).toBe(true);
		expect(isJiraAccessTokenFresh("not-a-date")).toBe(true);
	});

	it("isJiraAccessTokenFresh returns true for future expiry", () => {
		const future = new Date(Date.now() + 3600_000).toISOString();
		expect(isJiraAccessTokenFresh(future)).toBe(true);
	});

	it("isJiraAccessTokenFresh returns false for past expiry", () => {
		const past = new Date(Date.now() - 3600_000).toISOString();
		expect(isJiraAccessTokenFresh(past)).toBe(false);
	});

	it("mergeOAuthTokens sets authMethod to oauth and preserves existing fields", () => {
		const config = {
			authMethod: "api_token",
			domain: "acme",
			email: "user@acme.com",
			apiToken: "old-token",
			clientId: "client-id",
		};
		const patch = mergeOAuthTokens(config, {
			accessToken: "new-access-token",
			refreshToken: "new-refresh-token",
			expiresAt: "2026-12-31T00:00:00.000Z",
			cloudId: "cloud-id-123",
			siteName: "My Site",
			siteUrl: "https://acme.atlassian.net",
			clientId: "client-id",
			clientSecret: "client-secret",
		});
		expect(patch.authMethod).toBe("oauth");
		expect(patch.oauthAccessToken).toBe("new-access-token");
		expect(patch.oauthRefreshToken).toBe("new-refresh-token");
		expect(patch.cloudId).toBe("cloud-id-123");
		expect(patch.siteName).toBe("My Site");
		expect(patch.siteUrl).toBe("https://acme.atlassian.net");
		expect(patch.clientId).toBe("client-id");
		expect(patch.clientSecret).toBe("client-secret");
		// Should preserve old API token fields (not clear them)
		expect(patch.domain).toBe("acme");
		expect(patch.apiToken).toBe("old-token");
	});
});

describe("jira integration module (plugin registry)", () => {
	let tempDir: string;
	let previousTobyDir: string | undefined;
	let previousPluginsDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-jira-integ-"));
		previousTobyDir = process.env.TOBY_DIR;
		previousPluginsDir = process.env.TOBY_PLUGINS_DIR;
		process.env.TOBY_DIR = path.join(tempDir, "toby-home");
		process.env.TOBY_PLUGINS_DIR = path.join(tempDir, "toby-home", "plugins");
		resetPluginModuleCache();
		writeJiraPluginWrapper(path.join(tempDir, "toby-home", "plugins"));
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
		closeChatDbForTests();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("declares oauth and api_token auth methods", () => {
		const jira = getIntegrationModule("jira");
		expect(jira?.authMethods?.map((m) => m.id)).toEqual(["oauth", "api_token"]);
		expect(jira?.authMethods?.find((m) => m.isDefault)?.id).toBe("oauth");
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
		expect(tokenKeys).toContain("jira.apiToken");
	});

	it("configure tree includes both oauth and api_token fields with gating metadata", () => {
		const root = buildSettingsTree(
			[],
			[],
			{ "jira.authMethod": "oauth" },
			undefined,
			{ daemonRunning: true },
		);
		const integrations = root.children?.find((c) => c.key === "integrations");
		const jira = integrations?.children?.find((c) => c.key === "jira");
		const fields = jira?.children ?? [];
		const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
		expect(
			byKey["jira.authMethod"]?.selectChoices?.map((c) => c.value),
		).toEqual(["oauth", "api_token"]);
		expect(byKey["jira.clientId"]?.showForAuthMethods).toEqual(["oauth"]);
		expect(byKey["jira.clientSecret"]?.showForAuthMethods).toEqual(["oauth"]);
		expect(byKey["jira.domain"]?.showForAuthMethods).toEqual(["api_token"]);
		expect(byKey["jira.email"]?.showForAuthMethods).toEqual(["api_token"]);
		expect(byKey["jira.apiToken"]?.showForAuthMethods).toEqual(["api_token"]);
	});
});
