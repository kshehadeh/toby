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
	mergePluginConfigPatch,
} from "@toby/core/integrations/plugins/adapter";
import {
	pluginConfigShape,
	pluginDisconnect,
	pluginStatus,
	pluginToolsList,
} from "@toby/core/integrations/plugins/client";
import { migrateLegacyPluginCredentials } from "@toby/core/integrations/plugins/migrate";
import { resetPluginModuleCache } from "@toby/core/integrations/plugins/registry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const gmailCli = path.join(repoRoot, "../plugin-gmail/src/cli.ts");

function writeGmailPluginWrapper(pluginDir: string): string {
	fs.mkdirSync(pluginDir, { recursive: true });
	const wrapperPath = path.join(pluginDir, "toby-plugin-gmail");
	const script = `#!/usr/bin/env bash\nexec bun ${JSON.stringify(gmailCli)} "$@"\n`;
	fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
	return wrapperPath;
}

describe("gmail plugin", () => {
	let tempDir: string;
	let pluginDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-gmail-plugin-"));
		pluginDir = path.join(tempDir, "toby-home", "plugins");
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = path.join(tempDir, "toby-home");
		resetPluginModuleCache();
		writeGmailPluginWrapper(pluginDir);
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
		expect(isBuiltinIntegration("gmail")).toBe(false);
	});

	it("returns gmail identity and chatModelPrep from status", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-gmail");
		const status = pluginStatus(binaryPath, {
			config: { clientId: "c", clientSecret: "s" },
		});
		expect(status.ok).toBe(true);
		if (!status.ok) return;
		expect(status.data.name).toBe("gmail");
		expect(status.data.displayName).toBe("Gmail");
		expect(status.data.providerCategories).toEqual(["email"]);
		expect(status.data.chatModelPrep?.systemPromptSection).toContain("Gmail");
		expect(status.data.chatReadiness?.hint).toContain("toby connect gmail");
	});

	it("maps clientId and clientSecret in config shape", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-gmail");
		const shape = pluginConfigShape(binaryPath);
		expect(shape.ok).toBe(true);
		if (!shape.ok || !shape.data.fields) return;

		const keys = shape.data.fields.map((f) => f.key);
		expect(keys).toEqual(["clientId", "clientSecret"]);
		expect(
			shape.data.fields.find((f) => f.key === "clientSecret")?.masked,
		).toBe(true);
	});

	it("lists nine gmail chat tools", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-gmail");
		const list = pluginToolsList(binaryPath);
		expect(list.ok).toBe(true);
		if (!list.ok || !list.data.tools) return;
		expect(list.data.tools.map((t) => t.name)).toEqual([
			"getInboxUnreadOverview",
			"getUnreadEmailMetadataBatch",
			"batchModifyMessages",
			"archiveEmailById",
			"markAsReadById",
			"applyMultipleLabelsByMessageId",
			"listLabels",
			"createDraft",
			"getRecentEmails",
		]);
	});

	it("disconnect clears oauth token fields via config patch", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-gmail");
		const result = pluginDisconnect(binaryPath, {
			config: {
				clientId: "c",
				clientSecret: "s",
				oauthAccessToken: "access",
				oauthRefreshToken: "refresh",
				oauthExpiresAt: "2026-01-01T00:00:00.000Z",
			},
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.data.config?.oauthAccessToken).toBe("");
		expect(result.data.config?.oauthRefreshToken).toBe("");
	});

	it("registers plugin-backed gmail module with chatModelPrep", () => {
		const metadata = loadPluginMetadata({
			binaryPath: path.join(pluginDir, "toby-plugin-gmail"),
			binaryName: "toby-plugin-gmail",
		});
		expect("error" in metadata).toBe(false);
		if ("error" in metadata) return;

		const module = createPluginIntegrationModule(metadata);
		expect(module.name).toBe("gmail");
		expect(module.chatModelPrep?.systemPromptSection).toContain("Gmail");
		expect(module.providerCategories).toEqual(["email"]);
	});

	it("mergePluginConfigPatch writes oauth tokens to integrations.gmail", () => {
		writeCredentials({
			integrations: { gmail: { clientId: "c", clientSecret: "s" } },
		});
		mergePluginConfigPatch("gmail", {
			oauthAccessToken: "token-a",
			oauthRefreshToken: "token-r",
			oauthExpiresAt: "2026-06-01T00:00:00.000Z",
		});
		const creds = readCredentials();
		expect(creds.integrations?.gmail?.oauthAccessToken).toBe("token-a");
		expect(creds.integrations?.gmail?.oauthRefreshToken).toBe("token-r");
	});

	it("migrates legacy top-level gmail credentials", () => {
		writeCredentials({
			gmail: { clientId: "legacy-id", clientSecret: "legacy-secret" },
		});
		migrateLegacyPluginCredentials();
		const creds = readCredentials();
		expect(creds.integrations?.gmail?.clientId).toBe("legacy-id");
		expect(creds.integrations?.gmail?.clientSecret).toBe("legacy-secret");
	});

	it("migrates legacy oauth tokens from config.integrations.gmail", () => {
		writeCredentials({
			integrations: { gmail: { clientId: "c", clientSecret: "s" } },
		});
		writeConfig({
			integrations: {
				gmail: {
					accessToken: "legacy-access",
					refreshToken: "legacy-refresh",
					expiresAt: 1_700_000_000_000,
				},
			},
			personas: [],
		});
		migrateLegacyPluginCredentials();
		const creds = readCredentials();
		expect(creds.integrations?.gmail?.oauthAccessToken).toBe("legacy-access");
		expect(creds.integrations?.gmail?.oauthRefreshToken).toBe("legacy-refresh");
		const config = readConfig();
		expect(config.integrations.gmail?.connectedAt).toBeTruthy();
		expect(config.integrations.gmail?.accessToken).toBeUndefined();
	});

	it("discovers gmail via integration registry when plugin is installed", () => {
		const gmail = getIntegrationModule("gmail");
		expect(gmail).toBeDefined();
		expect(gmail?.displayName).toBe("Gmail");
	});
});
