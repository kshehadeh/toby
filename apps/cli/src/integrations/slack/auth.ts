import crypto from "node:crypto";
import http from "node:http";
import open from "open";
import { parseSlackOAuthExpiry } from "./tokens";
interface SlackOAuthClientCredentials {
	readonly clientId: string;
	readonly clientSecret: string;
	readonly redirectUri?: string;
}

const DEFAULT_REDIRECT_PORT = 9878;
const DEFAULT_REDIRECT_PATH = "/callback";
const DEFAULT_REDIRECT_URI = `http://localhost:${DEFAULT_REDIRECT_PORT}${DEFAULT_REDIRECT_PATH}`;

/** User scopes for PKCE + localhost (Slack disallows bot scopes on non-web redirects). */
const OAUTH_USER_SCOPES = [
	"channels:read",
	"channels:history",
	"chat:write",
	"groups:read",
	"groups:history",
	"im:read",
	"im:history",
	"mpim:read",
	"mpim:history",
	"users:read",
	"users:read.email",
	"search:read",
].join(",");

export interface SlackOAuthTokens {
	/** API access token (user token for localhost PKCE OAuth). */
	readonly accessToken: string;
	readonly tokenType: "user" | "bot";
	readonly refreshToken?: string;
	readonly expiresAt?: string;
	readonly teamId: string;
	readonly teamName: string;
}

/** PKCE pair for Slack OAuth (required for localhost / non-web redirect URIs). */
export function createSlackPkceChallenge(): {
	readonly codeVerifier: string;
	readonly codeChallenge: string;
} {
	const codeVerifier = toBase64Url(crypto.randomBytes(32));
	const codeChallenge = toBase64Url(
		crypto.createHash("sha256").update(codeVerifier).digest(),
	);
	return { codeVerifier, codeChallenge };
}

export async function runSlackOAuthFlow(
	credentials: SlackOAuthClientCredentials,
): Promise<SlackOAuthTokens> {
	const redirectUri = credentials.redirectUri?.trim() || DEFAULT_REDIRECT_URI;
	const redirect = parseRedirectUri(redirectUri);
	const { codeVerifier, codeChallenge } = createSlackPkceChallenge();
	const authUrl = new URL("https://slack.com/oauth/v2/authorize");
	authUrl.searchParams.set("client_id", credentials.clientId);
	// Localhost + PKCE is a "desktop" redirect: bot scopes are rejected; use user scopes only.
	authUrl.searchParams.set("user_scope", OAUTH_USER_SCOPES);
	authUrl.searchParams.set("redirect_uri", redirectUri);
	authUrl.searchParams.set("code_challenge", codeChallenge);
	authUrl.searchParams.set("code_challenge_method", "S256");

	const code = await captureAuthCode(authUrl.toString(), redirect, redirectUri);

	const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: credentials.clientId,
			code,
			redirect_uri: redirectUri,
			code_verifier: codeVerifier,
		}),
	});
	if (!tokenRes.ok) {
		const text = await tokenRes.text().catch(() => "");
		throw new Error(
			`Slack OAuth token exchange failed (${tokenRes.status}): ${text || tokenRes.statusText}`,
		);
	}

	const json = (await tokenRes.json()) as {
		ok?: boolean;
		error?: string;
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
		team?: { id?: string; name?: string };
		authed_user?: {
			access_token?: string;
			refresh_token?: string;
			expires_in?: number;
		};
	};
	const userToken =
		typeof json.authed_user?.access_token === "string"
			? json.authed_user.access_token
			: undefined;
	const userRefresh =
		typeof json.authed_user?.refresh_token === "string"
			? json.authed_user.refresh_token
			: undefined;
	const botToken =
		typeof json.access_token === "string" ? json.access_token : undefined;
	const botRefresh =
		typeof json.refresh_token === "string" ? json.refresh_token : undefined;
	const accessToken = userToken ?? botToken;
	const tokenType = userToken ? "user" : "bot";
	const refreshToken = tokenType === "user" ? userRefresh : botRefresh;
	const expiresIn =
		tokenType === "user"
			? (json.authed_user?.expires_in ?? json.expires_in)
			: (json.expires_in ?? json.authed_user?.expires_in);

	if (!json.ok || !accessToken) {
		throw new Error(
			`Slack OAuth failed: ${json.error ?? "missing access token (expected user token for localhost PKCE)"}`,
		);
	}

	return {
		accessToken,
		tokenType,
		refreshToken,
		expiresAt: parseSlackOAuthExpiry(
			typeof expiresIn === "number" ? expiresIn : undefined,
		),
		teamId: json.team?.id ?? "",
		teamName: json.team?.name ?? "",
	};
}

function captureAuthCode(
	authUrl: string,
	redirect: { port: number; path: string },
	redirectUri: string,
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
			res.end("<h1>Slack connected! You can close this tab.</h1>");
			server.close();
			resolve(code);
		});

		server.listen(redirect.port, () => {
			console.log("Opening browser for Slack authorization...");
			console.log(
				`Ensure your Slack app has PKCE enabled, user scopes configured, and this redirect URI registered: ${redirectUri}`,
			);
			console.log(
				"Note: localhost OAuth uses user scopes only (Slack does not allow bot scopes on non-web redirects).",
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
	});
}

function parseRedirectUri(redirectUri: string): { port: number; path: string } {
	const url = new URL(redirectUri);
	if (url.protocol !== "http:") {
		throw new Error(
			`Slack OAuth redirect URI must use http://localhost (got: ${redirectUri})`,
		);
	}
	if (!(url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
		throw new Error(
			`Slack OAuth redirect URI host must be localhost or 127.0.0.1 (got: ${url.hostname})`,
		);
	}
	const port = Number(url.port || DEFAULT_REDIRECT_PORT);
	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		throw new Error(`Slack OAuth redirect URI has invalid port: ${url.port}`);
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
