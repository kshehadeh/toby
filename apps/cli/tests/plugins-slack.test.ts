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
import { migrateLegacyPluginCredentials } from "@toby/core/integrations/plugins/migrate";
import { resetPluginModuleCache } from "@toby/core/integrations/plugins/registry";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const slackCli = path.join(repoRoot, "../plugin-slack/src/cli.ts");

function writeSlackPluginWrapper(pluginDir: string): string {
	fs.mkdirSync(pluginDir, { recursive: true });
	const wrapperPath = path.join(pluginDir, "toby-plugin-slack");
	const script = `#!/usr/bin/env bash\nexec bun ${JSON.stringify(slackCli)} "$@"\n`;
	fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
	return wrapperPath;
}

describe("slack plugin", () => {
	let tempDir: string;
	let pluginDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-slack-plugin-"));
		pluginDir = path.join(tempDir, "toby-home", "plugins");
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = path.join(tempDir, "toby-home");
		resetPluginModuleCache();
		writeSlackPluginWrapper(pluginDir);
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
		expect(isBuiltinIntegration("slack")).toBe(false);
	});

	it("returns slack identity, inbound capability, and chatModelPrep from status", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-slack");
		const status = pluginStatus(binaryPath, {
			config: { clientId: "c", clientSecret: "s" },
		});
		expect(status.ok).toBe(true);
		if (!status.ok) return;
		expect(status.data.name).toBe("slack");
		expect(status.data.capabilities).toContain("chat");
		expect(status.data.capabilities).toContain("inbound");
		expect(status.data.providerCategories).toEqual(["chat"]);
		expect(status.data.inboundPrep?.externalKeyFormat).toContain("slack:");
		expect(status.data.chatModelPrep?.systemPromptSection).toContain("Slack");
	});

	it("lists slack chat tools", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-slack");
		const tools = pluginToolsList(binaryPath);
		expect(tools.ok).toBe(true);
		if (!tools.ok) return;
		const names = (tools.data.tools ?? []).map((t) => t.name).sort();
		expect(names).toEqual([
			"postToChannel",
			"replyToPost",
			"searchChannels",
			"searchMessages",
			"searchUsers",
		]);
	});

	it("registers as IntegrationModule with chatInbound when inbound capability present", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-slack");
		const metadata = loadPluginMetadata({
			kind: "binary",
			binaryPath,
			binaryName: "toby-plugin-slack",
		});
		expect("error" in metadata).toBe(false);
		if ("error" in metadata) return;
		const mod = createPluginIntegrationModule(metadata);
		expect(mod.chatInbound).toBeDefined();
		expect(mod.capabilities).toContain("inbound");
	});

	it("appears in integration registry after discovery", () => {
		resetPluginModuleCache();
		const slack = getIntegrationModule("slack");
		expect(slack).toBeDefined();
		expect(slack?.authMethods?.map((m) => m.id)).toEqual([
			"oauth",
			"bot_token",
		]);
	});

	it("config shape includes inbound credential fields", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-slack");
		const shape = pluginConfigShape(binaryPath);
		expect(shape.ok).toBe(true);
		if (!shape.ok) return;
		const keys = (shape.data.fields ?? []).map((f) => f.key);
		expect(keys).toContain("botToken");
		expect(keys).toContain("appToken");
	});

	it("migrates legacy top-level slack credentials", () => {
		writeCredentials({
			slack: {
				clientId: "legacy-id",
				botToken: "xoxb-legacy",
			},
		});
		writeConfig({ integrations: {} });
		migrateLegacyPluginCredentials();
		const creds = readCredentials();
		expect(creds.integrations?.slack?.clientId).toBe("legacy-id");
		expect(creds.integrations?.slack?.botToken).toBe("xoxb-legacy");
		const cfg = readConfig();
		expect(cfg).toBeDefined();
	});

	it("returns a setup guide with redirect URI and scopes", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-slack");
		const guide = pluginSetupGuide(binaryPath);
		expect(guide.ok).toBe(true);
		if (!guide.ok) return;
		expect(guide.data.ok).toBe(true);
		expect(guide.data.name).toBe("slack");
		const steps = guide.data.steps ?? [];
		expect(steps.map((s) => s.id)).toContain("provider");
		const providerStep = steps.find((s) => s.id === "provider");
		expect(providerStep?.artifacts?.some((a) => a.id === "redirectUri")).toBe(
			true,
		);
		expect(providerStep?.artifacts?.some((a) => a.id === "scopes")).toBe(true);
	});
});
