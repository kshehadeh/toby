import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	clearCredentialsCache,
	readCredentials,
} from "@toby/core/config/index";
import {
	createMcpOAuthProvider,
	startMcpAuthCallback,
} from "@toby/core/integrations/mcp/index";

let tempDir: string;
let previousTobyDir: string | undefined;

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-mcp-oauth-"));
	previousTobyDir = process.env.TOBY_DIR;
	process.env.TOBY_DIR = tempDir;
	clearCredentialsCache();
});

afterEach(() => {
	clearCredentialsCache();
	if (previousTobyDir === undefined) {
		Reflect.deleteProperty(process.env, "TOBY_DIR");
	} else {
		process.env.TOBY_DIR = previousTobyDir;
	}
	fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("MCP OAuth provider", () => {
	const connectionId = "mcp_github";
	const serverUrl = "https://api.githubcopilot.com/mcp/";
	const pin = {
		authorizationServerUrl: "https://github.com/login/oauth",
		tokenEndpoint: "https://github.com/login/oauth/access_token",
	};

	it("persists authorization-server metadata for the code exchange", () => {
		const provider = createMcpOAuthProvider(connectionId, serverUrl);
		provider.saveClientInformation({ client_id: "client-1" });
		provider.saveAuthorizationServerInformation?.(pin);

		expect(provider.authorizationServerInformation?.()).toEqual(pin);
		expect(readCredentials().connections?.[connectionId]).toMatchObject({
			oauthClientId: "client-1",
			oauthAuthorizationEndpoint: pin.authorizationServerUrl,
			oauthTokenEndpoint: pin.tokenEndpoint,
		});

		const restored = createMcpOAuthProvider(connectionId, serverUrl);
		expect(restored.authorizationServerInformation?.()).toEqual(pin);
		expect(restored.clientInformation()).toMatchObject({
			client_id: "client-1",
			authorization_server: pin.authorizationServerUrl,
			token_endpoint: pin.tokenEndpoint,
		});
	});

	it("keeps the authorization-server pin on tokens across reconnects", () => {
		const provider = createMcpOAuthProvider(connectionId, serverUrl);
		provider.saveTokens({
			access_token: "access",
			token_type: "bearer",
			refresh_token: "refresh",
			authorization_server: pin.authorizationServerUrl,
			token_endpoint: pin.tokenEndpoint,
		});

		const restored = createMcpOAuthProvider(connectionId, serverUrl);
		expect(restored.tokens()).toMatchObject({
			access_token: "access",
			refresh_token: "refresh",
			authorization_server: pin.authorizationServerUrl,
			token_endpoint: pin.tokenEndpoint,
		});
	});

	it("persists OAuth state so a later provider instance can validate the callback", () => {
		const provider = createMcpOAuthProvider(connectionId, serverUrl);
		const state = "csrf-state";
		provider.saveState?.(state);

		const restored = createMcpOAuthProvider(connectionId, serverUrl);
		expect(restored.storedState?.()).toBe(state);
	});

	it("releases the OAuth callback port when the session is closed", async () => {
		const first = await startMcpAuthCallback();
		await first.ready;
		await first.close();
		const second = await startMcpAuthCallback();
		await second.ready;
		await second.close();
	});
});
