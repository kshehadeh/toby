import crypto from "node:crypto";
import { getSlackAuthMethod } from "@toby/core/config/index";
import { getIntegrationModule } from "@toby/core/integrations/index";
import { createSlackPkceChallenge } from "@toby/core/integrations/slack/auth";
import { createSlackTools } from "@toby/core/integrations/slack/tools";
import { describe, expect, it } from "vitest";

function toBase64Url(value: Buffer): string {
	return value
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

describe("slack integration module", () => {
	it("exposes expected chat tools", () => {
		const tools = createSlackTools({ dryRun: true, appliedActions: [] });
		expect(Object.keys(tools).sort()).toEqual([
			"postToChannel",
			"replyToPost",
			"searchChannels",
			"searchMessages",
			"searchUsers",
		]);
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

	it("getSlackAuthMethod prefers explicit bot token", () => {
		expect(
			getSlackAuthMethod(
				{ slack: { botToken: "xoxb-test" } },
				undefined,
				"xoxb-test",
			),
		).toBe("bot_token");
	});

	it("getSlackAuthMethod defaults to oauth without bot token", () => {
		expect(getSlackAuthMethod({ slack: { clientId: "id" } })).toBe("oauth");
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
