import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getIntegrationModule } from "@toby/core/integrations/index";
import { resetPluginModuleCache } from "@toby/core/integrations/plugins/registry";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createSlackPkceChallenge } from "../../plugin-slack/src/auth";
import { getSlackAuthMethod } from "../../plugin-slack/src/config";
import { TOOL_DEFINITIONS } from "../../plugin-slack/src/tools";

const repoRoot = path.resolve(import.meta.dirname, "..");
const slackCli = path.join(repoRoot, "../plugin-slack/src/cli.ts");

function writeSlackPluginWrapper(pluginDir: string): void {
	fs.mkdirSync(pluginDir, { recursive: true });
	const wrapperPath = path.join(pluginDir, "toby-plugin-slack");
	const script = `#!/usr/bin/env bash\nexec bun ${JSON.stringify(slackCli)} "$@"\n`;
	fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
}

function toBase64Url(value: Buffer): string {
	return value
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

describe("slack plugin helpers", () => {
	it("exposes expected chat tools", () => {
		expect(TOOL_DEFINITIONS.map((t) => t.name).sort()).toEqual([
			"postToChannel",
			"replyToPost",
			"searchChannels",
			"searchMessages",
			"searchUsers",
		]);
	});

	it("getSlackAuthMethod prefers explicit bot token", () => {
		expect(
			getSlackAuthMethod({ botToken: "xoxb-test" }, undefined, "xoxb-test"),
		).toBe("bot_token");
	});

	it("getSlackAuthMethod defaults to oauth without bot token", () => {
		expect(getSlackAuthMethod({ clientId: "id" })).toBe("oauth");
	});

	it("createSlackPkceChallenge matches Slack PKCE example", () => {
		const verifier = "secretpassword";
		const challenge = toBase64Url(
			crypto.createHash("sha256").update(verifier).digest(),
		);
		expect(challenge).toBe("ldMBaaWcQYtSATMV_IG8mf3wp7A6EW80arYoSW80ntU");
	});

	it("createSlackPkceChallenge returns verifier and S256 challenge pair", () => {
		const { codeVerifier, codeChallenge } = createSlackPkceChallenge();
		expect(codeVerifier.length).toBeGreaterThan(20);
		expect(codeChallenge).toBe(
			toBase64Url(crypto.createHash("sha256").update(codeVerifier).digest()),
		);
	});
});

describe("slack integration module (plugin registry)", () => {
	let tempDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-slack-integ-"));
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = path.join(tempDir, "toby-home");
		resetPluginModuleCache();
		writeSlackPluginWrapper(path.join(tempDir, "toby-home", "plugins"));
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

	it("declares oauth and bot_token auth methods", () => {
		const slack = getIntegrationModule("slack");
		expect(slack?.authMethods?.map((m) => m.id)).toEqual([
			"oauth",
			"bot_token",
		]);
		expect(slack?.authMethods?.find((m) => m.isDefault)?.id).toBe("oauth");
	});

	it("credential descriptors are gated by auth method", () => {
		const slack = getIntegrationModule("slack");
		const descriptors = slack?.getCredentialDescriptors() ?? [];
		const oauthKeys = descriptors
			.filter((d) => d.showForAuthMethods?.includes("oauth"))
			.map((d) => d.key);
		const tokenKeys = descriptors
			.filter((d) => d.showForAuthMethods?.includes("bot_token"))
			.map((d) => d.key);
		expect(oauthKeys).toContain("slack.clientId");
		expect(oauthKeys).toContain("slack.clientSecret");
		expect(tokenKeys).toContain("slack.botToken");
	});
});
