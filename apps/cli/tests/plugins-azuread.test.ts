import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
import {
	getIntegrationModule,
	isBuiltinIntegration,
} from "@toby/core/integrations/index";
import { resetPluginModuleCache } from "@toby/core/integrations/plugins/registry";
import {
	readCredentials,
	writeCredentials,
} from "@toby/core/config/index";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const azureadCli = path.join(repoRoot, "../plugin-azuread/src/cli.ts");

function writeAzureAdPluginWrapper(pluginDir: string): string {
	fs.mkdirSync(pluginDir, { recursive: true });
	const wrapperPath = path.join(pluginDir, "toby-plugin-azuread");
	const script = `#!/usr/bin/env bash\nexec bun ${JSON.stringify(azureadCli)} "$@"\n`;
	fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
	return wrapperPath;
}

describe("azuread plugin", () => {
	let tempDir: string;
	let pluginDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-azuread-plugin-"));
		pluginDir = path.join(tempDir, "toby-home", "plugins");
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = path.join(tempDir, "toby-home");
		resetPluginModuleCache();
		writeAzureAdPluginWrapper(pluginDir);
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
		expect(isBuiltinIntegration("azuread")).toBe(false);
	});

	it("returns azuread identity and chatModelPrep from status", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-azuread");
		const status = pluginStatus(binaryPath, {
			config: { tenantId: "t", clientId: "c" },
		});
		expect(status.ok).toBe(true);
		if (!status.ok) return;
		expect(status.data.name).toBe("azuread");
		expect(status.data.displayName).toBe("Azure AD");
		expect(status.data.authMethods?.map((m) => m.id)).toEqual([
			"oauth_pkce",
			"client_credentials",
		]);
		expect(status.data.chatModelPrep?.systemPromptSection).toContain(
			"Azure AD",
		);
		expect(status.data.chatReadiness?.hint).toContain("toby connect azuread");
	});

	it("maps auth-gated config shape fields", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-azuread");
		const shape = pluginConfigShape(binaryPath);
		expect(shape.ok).toBe(true);
		if (!shape.ok || !shape.data.fields) return;

		const clientSecret = shape.data.fields.find((f) => f.key === "clientSecret");
		expect(clientSecret?.showForAuthMethods).toEqual(["client_credentials"]);
	});

	it("lists five read-only graph tools", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-azuread");
		const list = pluginToolsList(binaryPath);
		expect(list.ok).toBe(true);
		if (!list.ok || !list.data.tools) return;
		expect(list.data.tools.map((t) => t.name)).toEqual([
			"listUsers",
			"searchUsers",
			"getUser",
			"getUserManager",
			"getUserDirectReports",
		]);
		expect(list.data.tools.every((t) => t.readOnly)).toBe(true);
	});

	it("disconnect clears oauth token fields via config patch", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-azuread");
		const result = pluginDisconnect(binaryPath, {
			config: {
				tenantId: "t",
				clientId: "c",
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

	it("registers plugin-backed azuread module with chatModelPrep", () => {
		const metadata = loadPluginMetadata({
			binaryPath: path.join(pluginDir, "toby-plugin-azuread"),
			binaryName: "toby-plugin-azuread",
		});
		expect("error" in metadata).toBe(false);
		if ("error" in metadata) return;

		const module = createPluginIntegrationModule(metadata);
		expect(module.name).toBe("azuread");
		expect(module.chatModelPrep?.systemPromptSection).toContain("Azure AD");
		expect(module.authMethods?.find((m) => m.isDefault)?.id).toBe("oauth_pkce");
	});

	it("mergePluginConfigPatch writes oauth tokens to integrations.azuread", () => {
		writeCredentials({ integrations: { azuread: { tenantId: "t", clientId: "c" } } });
		mergePluginConfigPatch("azuread", {
			oauthAccessToken: "token-a",
			oauthRefreshToken: "token-r",
			oauthExpiresAt: "2026-06-01T00:00:00.000Z",
		});
		const creds = readCredentials();
		expect(creds.integrations?.azuread?.oauthAccessToken).toBe("token-a");
		expect(creds.integrations?.azuread?.oauthRefreshToken).toBe("token-r");
	});

	it("migrates legacy top-level azuread credentials", () => {
		writeCredentials({
			azuread: {
				tenantId: "legacy-tenant",
				clientId: "legacy-client",
				authMethod: "oauth_pkce",
			},
		});
		migrateLegacyPluginCredentials();
		const creds = readCredentials();
		expect(creds.integrations?.azuread?.tenantId).toBe("legacy-tenant");
		expect(creds.integrations?.azuread?.clientId).toBe("legacy-client");
	});

	it("discovers azuread via integration registry when plugin is installed", () => {
		const azuread = getIntegrationModule("azuread");
		expect(azuread).toBeDefined();
		expect(azuread?.displayName).toBe("Azure AD");
	});
});
