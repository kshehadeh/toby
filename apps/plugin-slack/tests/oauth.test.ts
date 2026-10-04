import { afterEach, expect, it } from "bun:test";
import crypto from "node:crypto";
import http from "node:http";
import { runSlackOAuthFlow } from "../src/auth";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

it("binds a state-checked PKCE callback and exchanges without a client secret", async () => {
	const listener = http.createServer();
	await new Promise<void>((resolve) =>
		listener.listen(0, "127.0.0.1", resolve),
	);
	const address = listener.address();
	if (!address || typeof address === "string")
		throw new Error("Missing callback port");
	const port = address.port;
	await new Promise<void>((resolve) => listener.close(() => resolve()));
	const redirectUri = `http://127.0.0.1:${port}/callback`;
	let challenge = "";
	globalThis.fetch = (async (input, options) => {
		if (String(input).startsWith("https://slack.com/api/")) {
			const body = options?.body as URLSearchParams;
			expect(body.has("client_secret")).toBe(false);
			expect(body.get("code")).toBe("approved-code");
			expect(
				crypto
					.createHash("sha256")
					.update(body.get("code_verifier") ?? "")
					.digest("base64url"),
			).toBe(challenge);
			return Response.json({
				ok: true,
				authed_user: { access_token: "xoxp-test" },
				team: { id: "T1", name: "Test" },
			});
		}
		return originalFetch(input, options);
	}) as typeof fetch;
	const tokens = await runSlackOAuthFlow(
		{ clientId: "client-test", redirectUri },
		async (authorizationUrl) => {
			const url = new URL(authorizationUrl);
			expect(url.searchParams.has("scope")).toBe(false);
			challenge = url.searchParams.get("code_challenge") ?? "";
			const invalid = await originalFetch(
				`${redirectUri}?code=rejected&state=wrong`,
			);
			expect(invalid.status).toBe(400);
			const approved = new URL(redirectUri);
			approved.searchParams.set("code", "approved-code");
			approved.searchParams.set("state", url.searchParams.get("state") ?? "");
			const response = await originalFetch(approved);
			expect(response.status).toBe(200);
		},
	);
	expect(tokens.tokenType).toBe("user");
	expect(tokens.teamId).toBe("T1");
});
