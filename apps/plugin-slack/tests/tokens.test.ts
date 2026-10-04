import { afterEach, expect, it, mock } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { testSlackConnection } from "../src/client";
import {
	consumeTokenRefreshPatch,
	mergeOAuthTokens,
	refreshSlackOAuthAccessToken,
} from "../src/tokens";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
	consumeTokenRefreshPatch();
});
function expired() {
	return {
		authMethod: "oauth",
		clientId: "client",
		oauthUserToken: "old-access",
		oauthUserRefreshToken: "old-refresh",
		oauthExpiresAt: "2000-01-01T00:00:00.000Z",
	};
}
function rotated() {
	return Response.json({
		ok: true,
		access_token: "new-access",
		refresh_token: "new-refresh",
		expires_in: 43200,
	});
}

it("reuses rotated credentials across sequential API checks", async () => {
	const config = expired();
	let refreshes = 0;
	globalThis.fetch = Object.assign(
		mock(async (url: Parameters<typeof fetch>[0], options?: RequestInit) => {
			if (String(url).endsWith("oauth.v2.access")) {
				refreshes++;
				return rotated();
			}
			expect(new Headers(options?.headers).get("Authorization")).toBe(
				"Bearer new-access",
			);
			return Response.json({ ok: true, team: "Test workspace" });
		}),
		{ preconnect: originalFetch.preconnect },
	);
	await testSlackConnection(config);
	await testSlackConnection(config);
	expect(refreshes).toBe(1);
	expect(config.oauthUserRefreshToken).toBe("new-refresh");
	expect(consumeTokenRefreshPatch()?.oauthUserToken).toBe("new-access");
});

it("coalesces concurrent refreshes of the same config", async () => {
	const config = expired();
	globalThis.fetch = Object.assign(
		mock(async () => {
			await Bun.sleep(10);
			return rotated();
		}),
		{ preconnect: originalFetch.preconnect },
	);
	await Promise.all([
		refreshSlackOAuthAccessToken(config),
		refreshSlackOAuthAccessToken(config),
	]);
	expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});

it("clears old rotation metadata after a non-rotating authorization", () => {
	const patch = mergeOAuthTokens(expired(), {
		accessToken: "fresh-access",
		tokenType: "user",
	});
	expect(patch.oauthExpiresAt).toBe("");
	expect(patch.oauthUserRefreshToken).toBe("");
});

it("returns rotated credentials even when a later status probe fails", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slack-status-refresh-"));
	try {
		const preload = path.join(dir, "fetch.ts");
		fs.writeFileSync(
			preload,
			`
let refreshes = 0;
globalThis.fetch = async (url, options) => {
 if (String(url).endsWith("oauth.v2.access")) {
  if (++refreshes > 1) return Response.json({ ok: false, error: "invalid_refresh_token" });
  return Response.json({ ok: true, access_token: "new-access", refresh_token: "new-refresh", expires_in: 43200 });
 }
 if (new Headers(options?.headers).get("Authorization") !== "Bearer new-access") throw new Error("Stale access token");
 if (String(url).endsWith("conversations.list")) return Response.json({ ok: false, error: "missing_scope" });
 return Response.json({ ok: true, team: "Test workspace", members: [] });
};
`,
		);
		const result = spawnSync(
			process.execPath,
			[
				"--preload",
				preload,
				path.resolve(import.meta.dirname, "../src/cli.ts"),
				"status",
			],
			{
				input: JSON.stringify({
					config: expired(),
					state: { connectedAt: "2026-10-04" },
					validateTools: true,
				}),
				encoding: "utf8",
			},
		);
		expect(result.status).toBe(0);
		const status = JSON.parse(result.stdout);
		expect(status.ok).toBe(false);
		expect(status.details).toContain("missing_scope");
		expect(status.details).not.toContain("invalid_refresh_token");
		expect(status.config.oauthUserRefreshToken).toBe("new-refresh");
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
