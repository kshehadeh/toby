import { spawn } from "node:child_process";
import http from "node:http";
import type {
	OAuthAuthorizationServerInformation,
	OAuthClientInformation,
	OAuthClientMetadata,
	OAuthClientProvider,
	OAuthTokens,
} from "@ai-sdk/mcp";
import {
	getConnectionCredentials,
	writeConnectionCredentials,
} from "../connections";

export const MCP_OAUTH_REDIRECT_PORT = 9879;
export const MCP_OAUTH_REDIRECT_PATH = "/mcp/callback";
export const MCP_OAUTH_REDIRECT_URI = `http://127.0.0.1:${MCP_OAUTH_REDIRECT_PORT}${MCP_OAUTH_REDIRECT_PATH}`;

const ALLOWED_AUTH_HOST_SUFFIXES = [
	"github.com",
	"google.com",
	"microsoftonline.com",
	"okta.com",
	"auth0.com",
	"vercel.com",
	"anthropic.com",
	"openai.com",
	"cloudflare.com",
	"atlassian.com",
	"slack.com",
	"notion.so",
];

function readSecret(connectionId: string, field: string): string | undefined {
	const value = getConnectionCredentials(connectionId)[field]?.trim();
	return value ? value : undefined;
}

function patchSecrets(
	connectionId: string,
	patch: Record<string, string | undefined>,
): void {
	const current = getConnectionCredentials(connectionId);
	const next = { ...current };
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined || value === "") {
			Reflect.deleteProperty(next, key);
		} else {
			next[key] = value;
		}
	}
	writeConnectionCredentials(connectionId, next, {
		dualWriteIntegrations: false,
	});
}

function authServerPinPatch(
	info: OAuthAuthorizationServerInformation,
): Record<string, string> {
	return {
		oauthAuthorizationEndpoint: info.authorizationServerUrl,
		oauthTokenEndpoint: info.tokenEndpoint,
	};
}

function readAuthServerPin(
	connectionId: string,
	pending?: OAuthAuthorizationServerInformation,
): OAuthAuthorizationServerInformation | undefined {
	if (pending) return pending;
	const authorizationServerUrl = readSecret(
		connectionId,
		"oauthAuthorizationEndpoint",
	);
	const tokenEndpoint = readSecret(connectionId, "oauthTokenEndpoint");
	if (!authorizationServerUrl || !tokenEndpoint) return undefined;
	return { authorizationServerUrl, tokenEndpoint };
}

function pinFromCredentials(credentials?: {
	authorization_server?: string;
	token_endpoint?: string;
}): OAuthAuthorizationServerInformation | undefined {
	if (!credentials?.authorization_server || !credentials.token_endpoint) {
		return undefined;
	}
	return {
		authorizationServerUrl: credentials.authorization_server,
		tokenEndpoint: credentials.token_endpoint,
	};
}

export function createMcpOAuthProvider(
	connectionId: string,
	serverUrl: string,
): OAuthClientProvider {
	let pendingVerifier: string | undefined;
	let pendingState: string | undefined;
	let pendingAuthServer: OAuthAuthorizationServerInformation | undefined;

	return {
		get redirectUrl() {
			return MCP_OAUTH_REDIRECT_URI;
		},
		get clientMetadata(): OAuthClientMetadata {
			return {
				client_name: "Toby",
				redirect_uris: [MCP_OAUTH_REDIRECT_URI],
				grant_types: ["authorization_code", "refresh_token"],
				response_types: ["code"],
				token_endpoint_auth_method: "none",
			};
		},
		tokens() {
			const access = readSecret(connectionId, "oauthAccessToken");
			if (!access) return undefined;
			const pin = readAuthServerPin(connectionId, pendingAuthServer);
			return {
				access_token: access,
				token_type: "bearer",
				refresh_token: readSecret(connectionId, "oauthRefreshToken"),
				authorization_server: pin?.authorizationServerUrl,
				token_endpoint: pin?.tokenEndpoint,
			};
		},
		saveTokens(tokens: OAuthTokens) {
			const pin = pinFromCredentials(tokens);
			if (pin) pendingAuthServer = pin;
			patchSecrets(connectionId, {
				oauthAccessToken: tokens.access_token,
				oauthRefreshToken: tokens.refresh_token,
				oauthExpiresAt: tokens.expires_in
					? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
					: undefined,
				...(pin ? authServerPinPatch(pin) : {}),
			});
		},
		async redirectToAuthorization(url: URL) {
			openBrowser(url.toString());
		},
		saveCodeVerifier(codeVerifier: string) {
			pendingVerifier = codeVerifier;
			patchSecrets(connectionId, { oauthCodeVerifier: codeVerifier });
		},
		codeVerifier() {
			return (
				pendingVerifier ?? readSecret(connectionId, "oauthCodeVerifier") ?? ""
			);
		},
		clientInformation() {
			const clientId = readSecret(connectionId, "oauthClientId");
			if (!clientId) return undefined;
			const pin = readAuthServerPin(connectionId, pendingAuthServer);
			const info: OAuthClientInformation = {
				client_id: clientId,
				client_secret: readSecret(connectionId, "oauthClientSecret"),
				authorization_server: pin?.authorizationServerUrl,
				token_endpoint: pin?.tokenEndpoint,
			};
			return info;
		},
		saveClientInformation(info: OAuthClientInformation) {
			const pin = pinFromCredentials(info);
			if (pin) pendingAuthServer = pin;
			patchSecrets(connectionId, {
				oauthClientId: info.client_id,
				oauthClientSecret: info.client_secret,
				...(pin ? authServerPinPatch(pin) : {}),
			});
		},
		saveAuthorizationServerInformation(
			info: OAuthAuthorizationServerInformation,
		) {
			pendingAuthServer = info;
			patchSecrets(connectionId, authServerPinPatch(info));
		},
		authorizationServerInformation() {
			return readAuthServerPin(connectionId, pendingAuthServer);
		},
		async validateAuthorizationServerURL(_serverUrl, authorizationServerUrl) {
			const host = new URL(authorizationServerUrl).hostname.toLowerCase();
			const allowed = ALLOWED_AUTH_HOST_SUFFIXES.some(
				(suffix) => host === suffix || host.endsWith(`.${suffix}`),
			);
			const loopback = host === "localhost" || host === "127.0.0.1";
			const sameAsResource = (() => {
				try {
					return new URL(serverUrl).hostname.toLowerCase() === host;
				} catch {
					return false;
				}
			})();
			if (!allowed && !loopback && !sameAsResource) {
				throw new Error(
					`MCP OAuth authorization server "${host}" is not on the allowlist. Confirm the server before connecting.`,
				);
			}
		},
		state() {
			return pendingState ?? crypto.randomUUID();
		},
		saveState(state: string) {
			pendingState = state;
			patchSecrets(connectionId, { oauthState: state });
		},
		storedState() {
			return pendingState ?? readSecret(connectionId, "oauthState");
		},
	};
}

export type McpOAuthCallbackSession = {
	readonly ready: Promise<void>;
	readonly result: Promise<{ code: string; state?: string }>;
	close(): Promise<void>;
};

const MCP_OAUTH_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

let activeCallback: McpOAuthCallbackSession | undefined;

export async function startMcpAuthCallback(): Promise<McpOAuthCallbackSession> {
	if (activeCallback) {
		await activeCallback.close();
	}

	let settled = false;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	let resolveReady: () => void = () => {};
	let rejectReady: (error: Error) => void = () => {};
	let resolveResult: (value: { code: string; state?: string }) => void =
		() => {};
	let rejectResult: (error: Error) => void = () => {};

	const ready = new Promise<void>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	const result = new Promise<{ code: string; state?: string }>(
		(resolve, reject) => {
			resolveResult = resolve;
			rejectResult = reject;
		},
	);
	result.catch(() => {
		// Close/timeout can reject before the caller awaits `result`.
	});

	const finish = (settle: () => void): void => {
		if (settled) return;
		settled = true;
		if (timeout) {
			clearTimeout(timeout);
			timeout = undefined;
		}
		settle();
	};

	const server = http.createServer((req, res) => {
		const url = new URL(
			req.url ?? "",
			`http://127.0.0.1:${MCP_OAUTH_REDIRECT_PORT}`,
		);
		if (url.pathname !== MCP_OAUTH_REDIRECT_PATH) {
			res.writeHead(404);
			res.end("Not found");
			return;
		}
		const error = url.searchParams.get("error");
		if (error) {
			res.writeHead(400, { "Content-Type": "text/html" });
			res.end(`<h1>MCP authorization failed</h1><p>${error}</p>`);
			finish(() => rejectResult(new Error(`OAuth error: ${error}`)));
			return;
		}
		const code = url.searchParams.get("code");
		if (!code) {
			res.writeHead(400, { "Content-Type": "text/html" });
			res.end("<h1>No authorization code received</h1>");
			finish(() => rejectResult(new Error("No authorization code received")));
			return;
		}
		res.writeHead(200, { "Content-Type": "text/html" });
		res.end("<h1>MCP server connected. You can close this tab.</h1>");
		finish(() =>
			resolveResult({
				code,
				state: url.searchParams.get("state") ?? undefined,
			}),
		);
	});

	const close = (): Promise<void> => {
		finish(() => {
			rejectReady(new Error("MCP OAuth callback cancelled"));
			rejectResult(new Error("MCP OAuth callback cancelled"));
		});
		if (activeCallback?.close === close) {
			activeCallback = undefined;
		}
		return new Promise((resolve) => {
			if (!server.listening) {
				resolve();
				return;
			}
			server.close(() => resolve());
		});
	};

	const session: McpOAuthCallbackSession = { ready, result, close };

	server.once("error", (err) => {
		const wrapped = new Error(
			`MCP OAuth callback server error: ${err.message}`,
		);
		finish(() => {
			rejectReady(wrapped);
			rejectResult(wrapped);
		});
	});
	timeout = setTimeout(() => {
		finish(() => {
			rejectResult(
				new Error("Timed out waiting for MCP OAuth in the browser."),
			);
		});
		void session.close();
	}, MCP_OAUTH_CALLBACK_TIMEOUT_MS);
	server.listen(MCP_OAUTH_REDIRECT_PORT, "127.0.0.1", () => {
		resolveReady();
	});

	activeCallback = session;
	return session;
}

function openBrowser(url: string): void {
	spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
}

export function parseHeaderBag(raw?: string): Record<string, string> {
	if (!raw?.trim()) return {};
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}
		const out: Record<string, string> = {};
		for (const [key, value] of Object.entries(
			parsed as Record<string, unknown>,
		)) {
			if (typeof value === "string" && value.trim()) {
				out[key] = value;
			}
		}
		return out;
	} catch {
		return {};
	}
}

export function parseEnvBag(raw?: string): Record<string, string> {
	return parseHeaderBag(raw);
}
