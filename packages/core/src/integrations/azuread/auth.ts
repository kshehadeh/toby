import crypto from "node:crypto";
import http from "node:http";
import open from "open";

const DEFAULT_REDIRECT_PORT = 9877;
const DEFAULT_REDIRECT_PATH = "/callback";
const DEFAULT_REDIRECT_URI = `http://localhost:${DEFAULT_REDIRECT_PORT}${DEFAULT_REDIRECT_PATH}`;
const AUTH_SCOPE =
	"offline_access openid profile User.Read.All User.ReadBasic.All";

export async function runAzureAdOAuthPkceFlow(params: {
	readonly tenantId: string;
	readonly clientId: string;
	readonly redirectUri?: string;
}): Promise<{
	readonly accessToken: string;
	readonly refreshToken: string;
	readonly expiresAtMs: number;
}> {
	const redirectUri = params.redirectUri?.trim() || DEFAULT_REDIRECT_URI;
	const redirect = parseRedirectUri(redirectUri);
	const codeVerifier = toBase64Url(crypto.randomBytes(32));
	const codeChallenge = toBase64Url(
		crypto.createHash("sha256").update(codeVerifier).digest(),
	);
	const authUrl = new URL(
		`https://login.microsoftonline.com/${encodeURIComponent(params.tenantId)}/oauth2/v2.0/authorize`,
	);
	authUrl.searchParams.set("client_id", params.clientId);
	authUrl.searchParams.set("response_type", "code");
	authUrl.searchParams.set("redirect_uri", redirectUri);
	authUrl.searchParams.set("response_mode", "query");
	authUrl.searchParams.set("scope", AUTH_SCOPE);
	authUrl.searchParams.set("code_challenge", codeChallenge);
	authUrl.searchParams.set("code_challenge_method", "S256");

	const code = await captureAuthCode(authUrl.toString(), redirect);

	const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(
		params.tenantId,
	)}/oauth2/v2.0/token`;
	const tokenRes = await fetch(tokenUrl, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: params.clientId,
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
			code_verifier: codeVerifier,
			scope: AUTH_SCOPE,
		}),
	});
	if (!tokenRes.ok) {
		const text = await tokenRes.text().catch(() => "");
		throw new Error(
			`Azure AD OAuth token exchange failed (${tokenRes.status}): ${text || tokenRes.statusText}`,
		);
	}

	const json = (await tokenRes.json()) as {
		access_token?: unknown;
		refresh_token?: unknown;
		expires_in?: unknown;
	};
	if (
		typeof json.access_token !== "string" ||
		typeof json.refresh_token !== "string"
	) {
		throw new Error(
			"Azure AD OAuth token exchange missing access/refresh token",
		);
	}
	const expiresInSec =
		typeof json.expires_in === "number" ? json.expires_in : 3600;
	return {
		accessToken: json.access_token,
		refreshToken: json.refresh_token,
		expiresAtMs: Date.now() + Math.max(60, expiresInSec) * 1000,
	};
}

function captureAuthCode(
	authUrl: string,
	redirect: { port: number; path: string },
): Promise<string> {
	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			const url = new URL(req.url ?? "", `http://localhost:${redirect.port}`);
			if (url.pathname !== redirect.path) {
				res.writeHead(404);
				res.end("Not found");
				return;
			}

			const code = url.searchParams.get("code");
			const error = url.searchParams.get("error");
			if (error) {
				res.writeHead(400);
				res.end(`OAuth error: ${error}`);
				server.close();
				reject(new Error(`OAuth error: ${error}`));
				return;
			}
			if (!code) {
				res.writeHead(400);
				res.end("No authorization code received");
				server.close();
				reject(new Error("No authorization code received"));
				return;
			}

			res.writeHead(200, { "Content-Type": "text/html" });
			res.end("<h1>Azure AD connected. You can close this tab.</h1>");
			server.close();
			resolve(code);
		});

		server.listen(redirect.port, () => {
			console.log("Opening browser for Azure AD authorization...");
			console.log(
				`If sign-in fails with "No reply address provided", add this redirect URI to your Azure app registration: ${`http://localhost:${redirect.port}${redirect.path}`}`,
			);
			open(authUrl).catch(() => {
				console.log(
					`Could not open browser. Visit this URL manually:\n${authUrl}`,
				);
			});
		});

		server.on("error", (err) => {
			reject(new Error(`Local server error: ${err.message}`));
		});

		const timeout = setTimeout(() => {
			server.close();
			reject(
				new Error(
					"Timed out waiting for Azure AD callback. Verify the app registration includes the configured redirect URI.",
				),
			);
		}, 5 * 60_000);

		server.on("close", () => {
			clearTimeout(timeout);
		});
	});
}

function parseRedirectUri(value: string): { port: number; path: string } {
	const parsed = new URL(value);
	if (parsed.protocol !== "http:") {
		throw new Error(
			`Azure AD OAuth redirect URI must use http://localhost (got: ${value})`,
		);
	}
	if (!(parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")) {
		throw new Error(
			`Azure AD OAuth redirect URI host must be localhost or 127.0.0.1 (got: ${parsed.hostname})`,
		);
	}
	const port = Number(parsed.port || DEFAULT_REDIRECT_PORT);
	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		throw new Error(
			`Azure AD OAuth redirect URI has invalid port: ${parsed.port}`,
		);
	}
	return { port, path: parsed.pathname || "/" };
}

function toBase64Url(value: Buffer): string {
	return value
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}
