import crypto from "node:crypto";
import http from "node:http";
import open from "open";

type JsonRecord = Record<string, unknown>;

const DEFAULT_REDIRECT_PORT = 9879;
const DEFAULT_REDIRECT_PATH = "/callback";
export const DEFAULT_REDIRECT_URI = `http://localhost:${DEFAULT_REDIRECT_PORT}${DEFAULT_REDIRECT_PATH}`;

const ATLASSIAN_AUTHORIZE_URL = "https://auth.atlassian.com/authorize";
const ATLASSIAN_TOKEN_URL = "https://auth.atlassian.com/oauth/token";
const ATLASSIAN_ACCESSIBLE_RESOURCES_URL =
	"https://api.atlassian.com/oauth/token/accessible-resources";

/** Jira read scopes for OAuth 2.0 (3LO) with offline_access for refresh tokens. */
export const OAUTH_SCOPES = [
	"read:jira-work",
	"read:jira-user",
	"offline_access",
].join(" ");

export interface JiraAccessibleResource {
	readonly id: string;
	readonly name: string;
	readonly url: string;
	readonly scopes: readonly string[];
}

export interface JiraOAuthTokens {
	readonly accessToken: string;
	readonly refreshToken?: string;
	readonly expiresAt?: string;
	readonly cloudId: string;
	readonly siteName: string;
	readonly siteUrl: string;
}

interface JiraOAuthClientCredentials {
	readonly clientId: string;
	readonly clientSecret: string;
	readonly redirectUri?: string;
}

export function createJiraPkceChallenge(): {
	readonly codeVerifier: string;
	readonly codeChallenge: string;
} {
	const codeVerifier = toBase64Url(crypto.randomBytes(32));
	const codeChallenge = toBase64Url(
		crypto.createHash("sha256").update(codeVerifier).digest(),
	);
	return { codeVerifier, codeChallenge };
}

export async function fetchAccessibleResources(
	accessToken: string,
): Promise<JiraAccessibleResource[]> {
	const res = await fetch(ATLASSIAN_ACCESSIBLE_RESOURCES_URL, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: "application/json",
		},
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(
			`Failed to fetch accessible resources (${res.status}): ${text || res.statusText}`,
		);
	}
	const json = (await res.json()) as JsonRecord[];
	if (!Array.isArray(json)) {
		throw new Error("Accessible resources response was not an array.");
	}
	return json.map((item) => ({
		id: String(item.id ?? ""),
		name: String(item.name ?? ""),
		url: String(item.url ?? ""),
		scopes: Array.isArray(item.scopes) ? item.scopes.map((s) => String(s)) : [],
	}));
}

export async function runJiraOAuthFlow(
	credentials: JiraOAuthClientCredentials,
): Promise<JiraOAuthTokens> {
	const redirectUri = credentials.redirectUri?.trim() || DEFAULT_REDIRECT_URI;
	const redirect = parseRedirectUri(redirectUri);
	const { codeVerifier, codeChallenge } = createJiraPkceChallenge();
	const state = toBase64Url(crypto.randomBytes(16));

	const authUrl = new URL(ATLASSIAN_AUTHORIZE_URL);
	authUrl.searchParams.set("audience", "api.atlassian.com");
	authUrl.searchParams.set("client_id", credentials.clientId);
	authUrl.searchParams.set("scope", OAUTH_SCOPES);
	authUrl.searchParams.set("redirect_uri", redirectUri);
	authUrl.searchParams.set("state", state);
	authUrl.searchParams.set("response_type", "code");
	authUrl.searchParams.set("prompt", "consent");

	const code = await captureAuthCode(
		authUrl.toString(),
		redirect,
		redirectUri,
		state,
	);

	const tokenRes = await fetch(ATLASSIAN_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			grant_type: "authorization_code",
			client_id: credentials.clientId,
			client_secret: credentials.clientSecret,
			code,
			redirect_uri: redirectUri,
		}),
	});
	if (!tokenRes.ok) {
		const text = await tokenRes.text().catch(() => "");
		throw new Error(
			`Jira OAuth token exchange failed (${tokenRes.status}): ${text || tokenRes.statusText}`,
		);
	}

	const tokenJson = (await tokenRes.json()) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
		error?: string;
	};

	if (!tokenJson.access_token) {
		throw new Error(
			`Jira OAuth token exchange failed: ${tokenJson.error ?? "missing access token"}`,
		);
	}

	const resources = await fetchAccessibleResources(tokenJson.access_token);
	if (resources.length === 0) {
		throw new Error(
			"No accessible Jira sites found for this token. Ensure your Atlassian app has Jira permissions and the user has access to at least one site.",
		);
	}

	// Use the first resource (user may have multiple sites, pick the first)
	const resource = resources[0];

	const expiresAt = parseExpiry(
		typeof tokenJson.expires_in === "number" ? tokenJson.expires_in : undefined,
	);

	return {
		accessToken: tokenJson.access_token,
		refreshToken: tokenJson.refresh_token,
		expiresAt,
		cloudId: resource.id,
		siteName: resource.name,
		siteUrl: resource.url,
	};
}

function parseExpiry(expiresInSec: number | undefined): string | undefined {
	if (expiresInSec === undefined || !Number.isFinite(expiresInSec)) {
		return undefined;
	}
	return new Date(Date.now() + Math.max(60, expiresInSec) * 1000).toISOString();
}

function logStderr(message: string): void {
	process.stderr.write(`${message}\n`);
}

function captureAuthCode(
	authUrl: string,
	redirect: { port: number; path: string },
	redirectUri: string,
	expectedState: string,
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
			const returnedState = url.searchParams.get("state");

			if (error) {
				res.writeHead(400);
				res.end(`OAuth error: ${error}`);
				server.close();
				reject(new Error(`OAuth error: ${error}`));
				return;
			}

			if (returnedState !== expectedState) {
				res.writeHead(400);
				res.end("State mismatch");
				server.close();
				reject(new Error("OAuth state mismatch — possible CSRF attack."));
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
			res.end("<h1>Jira connected! You can close this tab.</h1>");
			server.close();
			resolve(code);
		});

		server.listen(redirect.port, () => {
			logStderr("Opening browser for Atlassian authorization...");
			logStderr(
				`Ensure your Atlassian app has this callback URL registered: ${redirectUri}`,
			);
			open(authUrl).catch(() => {
				logStderr(
					`Could not open browser. Visit this URL manually:\n${authUrl}`,
				);
			});
		});

		server.on("error", (err) => {
			reject(new Error(`Local server error: ${err.message}`));
		});
	});
}

function parseRedirectUri(redirectUri: string): {
	port: number;
	path: string;
} {
	const url = new URL(redirectUri);
	if (url.protocol !== "http:") {
		throw new Error(
			`Jira OAuth redirect URI must use http://localhost (got: ${redirectUri})`,
		);
	}
	if (!(url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
		throw new Error(
			`Jira OAuth redirect URI host must be localhost or 127.0.0.1 (got: ${url.hostname})`,
		);
	}
	const port = Number(url.port || DEFAULT_REDIRECT_PORT);
	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		throw new Error(`Jira OAuth redirect URI has invalid port: ${url.port}`);
	}
	return { port, path: url.pathname || DEFAULT_REDIRECT_PATH };
}

function toBase64Url(value: Buffer): string {
	return value
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}
