import {
	type JiraAuthMethod,
	getConfigField,
	getJiraAuthMethod,
	normalizeConfig,
} from "./config";

type JsonRecord = Record<string, unknown>;

const ATLASSIAN_OAUTH_TOKEN_URL = "https://auth.atlassian.com/oauth/token";

let lastTokenPatch: JsonRecord | undefined;

export function consumeTokenRefreshPatch(): JsonRecord | undefined {
	const patch = lastTokenPatch;
	lastTokenPatch = undefined;
	return patch;
}

export function parseJiraOAuthExpiry(
	expiresInSec: number | undefined,
): string | undefined {
	if (expiresInSec === undefined || !Number.isFinite(expiresInSec)) {
		return undefined;
	}
	return new Date(Date.now() + Math.max(60, expiresInSec) * 1000).toISOString();
}

export function isJiraAccessTokenFresh(
	expiresAtIso: string | undefined,
): boolean {
	if (!expiresAtIso?.trim()) {
		return true;
	}
	const expiresAtMs = Date.parse(expiresAtIso);
	if (!Number.isFinite(expiresAtMs)) {
		return true;
	}
	return expiresAtMs - Date.now() > 60_000;
}

export function mergeOAuthTokens(
	config: JsonRecord,
	tokens: {
		readonly accessToken: string;
		readonly refreshToken?: string;
		readonly expiresAt?: string;
		readonly cloudId?: string;
		readonly siteName?: string;
		readonly siteUrl?: string;
		readonly clientId?: string;
		readonly clientSecret?: string;
		readonly redirectUri?: string;
	},
): JsonRecord {
	const authMethod: JiraAuthMethod = "oauth";
	const clientId = tokens.clientId ?? getConfigField(config, "clientId") ?? "";
	const clientSecret =
		tokens.clientSecret ?? getConfigField(config, "clientSecret") ?? "";
	const redirectUri =
		tokens.redirectUri ?? getConfigField(config, "redirectUri") ?? "";

	return {
		...normalizeConfig(config),
		authMethod,
		clientId,
		clientSecret,
		redirectUri,
		oauthAccessToken: tokens.accessToken,
		oauthRefreshToken:
			tokens.refreshToken ?? getConfigField(config, "oauthRefreshToken") ?? "",
		oauthExpiresAt:
			tokens.expiresAt ?? getConfigField(config, "oauthExpiresAt") ?? "",
		cloudId: tokens.cloudId ?? getConfigField(config, "cloudId") ?? "",
		siteName: tokens.siteName ?? getConfigField(config, "siteName") ?? "",
		siteUrl: tokens.siteUrl ?? getConfigField(config, "siteUrl") ?? "",
	};
}

export async function refreshJiraOAuthAccessToken(
	config: JsonRecord,
): Promise<{ accessToken: string; configPatch: JsonRecord }> {
	const authMethod = getJiraAuthMethod(config);
	if (authMethod === "api_token") {
		throw new Error(
			"Jira API token auth cannot be refreshed. Create a new token in `toby configure` or reconnect with OAuth.",
		);
	}

	const clientId = getConfigField(config, "clientId");
	const clientSecret = getConfigField(config, "clientSecret");
	if (!clientId || !clientSecret) {
		throw new Error(
			"Jira OAuth client credentials are missing. Set clientId and clientSecret in `toby configure`.",
		);
	}

	const refreshToken = getConfigField(config, "oauthRefreshToken");
	if (!refreshToken) {
		throw new Error(
			"Jira OAuth refresh token is missing. Run `toby connect jira` again.",
		);
	}

	const res = await fetch(ATLASSIAN_OAUTH_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			grant_type: "refresh_token",
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: refreshToken,
		}),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(
			`Jira OAuth refresh failed (${res.status}): ${text || res.statusText}`,
		);
	}

	const json = (await res.json()) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
		error?: string;
	};

	if (!json.access_token) {
		throw new Error(
			`Jira OAuth refresh failed: ${json.error ?? "missing access token"}`,
		);
	}

	const configPatch = mergeOAuthTokens(config, {
		accessToken: json.access_token,
		refreshToken:
			typeof json.refresh_token === "string"
				? json.refresh_token
				: refreshToken,
		expiresAt: parseJiraOAuthExpiry(
			typeof json.expires_in === "number" ? json.expires_in : undefined,
		),
	});

	lastTokenPatch = configPatch;
	return { accessToken: json.access_token, configPatch };
}
