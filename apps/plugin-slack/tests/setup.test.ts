import { afterEach, describe, expect, it, mock } from "bun:test";
import { OAUTH_USER_SCOPES } from "../src/auth";
import {
	buildSlackManifest,
	slackAppCreationUrl,
	validateSlackSetup,
} from "../src/setup";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

function slackFetch(
	scopes = "chat:write,app_mentions:read,im:history",
	error?: string,
) {
	return mock(async (_input: unknown, options?: RequestInit) => {
		const token = new Headers(options?.headers).get("Authorization");
		return Response.json(
			error
				? { ok: false, error }
				: token?.includes("xapp-")
					? { ok: true, url: "wss://secret-ticket" }
					: {
							ok: true,
							bot_id: "B1",
							user_id: "U1",
							team_id: "T1",
							team: "Test team",
						},
			{ headers: { "x-oauth-scopes": scopes } },
		);
	});
}

describe("Slack setup", () => {
	it("publishes the same manifest used by the creation link", async () => {
		const manifest = buildSlackManifest();
		const published = await Bun.file(
			new URL(
				"../../help-site/static/slack-app-manifest.json",
				import.meta.url,
			),
		).json();
		expect(published).toEqual(manifest);
		expect(
			JSON.parse(
				new URL(slackAppCreationUrl()).searchParams.get("manifest_json") ?? "",
			),
		).toEqual(manifest);
		expect(manifest.oauth_config.scopes.user).toEqual(
			OAUTH_USER_SCOPES.split(","),
		);
		expect(manifest.settings.event_subscriptions.bot_events).toContain(
			"message.im",
		);
		expect(manifest.features.app_home.messages_tab_read_only_enabled).toBe(
			false,
		);
	});
	it("allows tools-only setup without an app token", async () => {
		globalThis.fetch = slackFetch();
		const result = await validateSlackSetup(
			{ botToken: "xoxb-test" },
			{ stage: "bot", inbound: false },
		);
		expect(result.details.teamName).toBe("Test team");
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});
	it("requires a separate app token for inbound", async () => {
		globalThis.fetch = slackFetch();
		await expect(
			validateSlackSetup(
				{ botToken: "xoxb-test" },
				{ stage: "bot", inbound: true },
			),
		).rejects.toThrow("App-Level Token");
	});
	it("checks Socket Mode access without returning its private websocket URL", async () => {
		globalThis.fetch = slackFetch();
		const result = await validateSlackSetup(
			{ botToken: "xoxb-test", appToken: "xapp-test" },
			{ stage: "bot", inbound: true },
		);
		expect(globalThis.fetch).toHaveBeenCalledTimes(2);
		expect(result.config.botUserId).toBe("U1");
		expect(JSON.stringify(result)).not.toContain("secret-ticket");
	});
	it("rejects missing inbound scopes", async () => {
		globalThis.fetch = slackFetch("chat:write");
		await expect(
			validateSlackSetup(
				{ botToken: "xoxb-test", appToken: "xapp-test" },
				{ stage: "bot", inbound: true },
			),
		).rejects.toThrow("app_mentions:read");
	});
	it("rejects an invalid token without echoing it", async () => {
		globalThis.fetch = slackFetch("", "invalid_auth");
		await expect(
			validateSlackSetup(
				{ botToken: "xoxb-private" },
				{ stage: "bot", inbound: false },
			),
		).rejects.toThrow("auth.test: invalid_auth");
	});
	it("preserves saved authorization by rejecting a different bot workspace", async () => {
		globalThis.fetch = slackFetch();
		await expect(
			validateSlackSetup(
				{ botToken: "xoxb-test", oauthUserToken: "xoxp-saved", teamId: "T2" },
				{ stage: "bot", inbound: false },
			),
		).rejects.toThrow("different workspace");
	});
});
