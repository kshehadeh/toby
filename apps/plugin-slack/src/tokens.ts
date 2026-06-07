import {
	getConfigField,
	getSlackAuthMethod,
	normalizeConfig,
	type SlackAuthMethod,
} from "./config";

const SLACK_OAUTH_ACCESS_URL = "https://slack.com/api/oauth.v2.access";

type JsonRecord = Record<string, unknown>;

let lastTokenPatch: JsonRecord | undefined;

export function consumeTokenRefreshPatch(): JsonRecord | undefined {
	const patch = lastTokenPatch;
	lastTokenPatch = undefined;
	return patch;
}

export function parseSlackOAuthExpiry(
	expiresInSec: number | undefined,
): string | undefined {
	if (expiresInSec === undefined || !Number.isFinite(expiresInSec)) {
		return undefined;
	}
	return new Date(Date.now() + Math.max(60, expiresInSec) * 1000).toISOString();
}

export function isSlackAccessTokenFresh(
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
		readonly tokenType: "user" | "bot";
		readonly refreshToken?: string;
		readonly expiresAt?: string;
		readonly teamId?: string;
		readonly teamName?: string;
		readonly clientId?: string;
		readonly clientSecret?: string;
		readonly redirectUri?: string;
	},
): JsonRecord {
	const authMethod = getSlackAuthMethod(config);
	const clientId =
		tokens.clientId ?? getConfigField(config, "clientId") ?? "";
	const clientSecret =
		tokens.clientSecret ?? getConfigField(config, "clientSecret") ?? "";
	const redirectUri =
		tokens.redirectUri ?? getConfigField(config, "redirectUri") ?? "";

	const patch: JsonRecord = {
		...normalizeConfig(config),
		authMethod,
		clientId,
		clientSecret,
		redirectUri,
		teamId: tokens.teamId ?? getConfigField(config, "teamId") ?? "",
		teamName: tokens.teamName ?? getConfigField(config, "teamName") ?? "",
		oauthExpiresAt:
			tokens.expiresAt ?? getConfigField(config, "oauthExpiresAt") ?? "",
		oauthUserToken:
			tokens.tokenType === "user"
				? tokens.accessToken
				: (getConfigField(config, "oauthUserToken") ?? ""),
		oauthBotToken:
			tokens.tokenType === "bot"
				? tokens.accessToken
				: (getConfigField(config, "oauthBotToken") ?? ""),
		oauthUserRefreshToken:
			tokens.tokenType === "user" && tokens.refreshToken
				? tokens.refreshToken
				: (getConfigField(config, "oauthUserRefreshToken") ?? ""),
		oauthBotRefreshToken:
			tokens.tokenType === "bot" && tokens.refreshToken
				? tokens.refreshToken
				: (getConfigField(config, "oauthBotRefreshToken") ?? ""),
	};

	return patch;
}

export async function refreshSlackOAuthAccessToken(
	config: JsonRecord,
): Promise<{ accessToken: string; configPatch: JsonRecord }> {
	const authMethod = getSlackAuthMethod(config);
	if (authMethod === "bot_token") {
		throw new Error(
			"Slack bot tokens cannot be refreshed automatically. Add a new token in `toby configure` or reconnect with OAuth.",
		);
	}

	const clientId = getConfigField(config, "clientId");
	if (!clientId) {
		throw new Error(
			"Slack OAuth client ID is missing. Set credentials in `toby configure`.",
		);
	}

	const userRefresh = getConfigField(config, "oauthUserRefreshToken");
	const botRefresh = getConfigField(config, "oauthBotRefreshToken");
	const refreshToken = userRefresh || botRefresh;
	if (!refreshToken) {
		throw new Error(
			"Slack OAuth refresh token is missing. Run `toby connect slack` again.",
		);
	}

	const tokenType: "user" | "bot" = userRefresh ? "user" : "bot";

	const res = await fetch(SLACK_OAUTH_ACCESS_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: clientId,
			grant_type: "refresh_token",
			refresh_token: refreshToken,
		}),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(
			`Slack OAuth refresh failed (${res.status}): ${text || res.statusText}`,
		);
	}

	const json = (await res.json()) as {
		ok?: boolean;
		error?: string;
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
		authed_user?: {
			access_token?: string;
			refresh_token?: string;
			expires_in?: number;
		};
	};
	if (!json.ok) {
		throw new Error(`Slack OAuth refresh failed: ${json.error ?? "unknown"}`);
	}

	const userToken =
		typeof json.authed_user?.access_token === "string"
			? json.authed_user.access_token
			: undefined;
	const userRefreshNext =
		typeof json.authed_user?.refresh_token === "string"
			? json.authed_user.refresh_token
			: undefined;
	const botToken =
		typeof json.access_token === "string" ? json.access_token : undefined;
	const accessToken =
		tokenType === "user" ? (userToken ?? botToken) : (botToken ?? userToken);

	if (!accessToken) {
		throw new Error("Slack OAuth refresh response missing access token.");
	}

	const expiresIn =
		tokenType === "user"
			? (json.authed_user?.expires_in ?? json.expires_in)
			: (json.expires_in ?? json.authed_user?.expires_in);

	const configPatch = mergeOAuthTokens(config, {
		accessToken,
		tokenType,
		refreshToken:
			userRefreshNext ??
			(typeof json.refresh_token === "string"
				? json.refresh_token
				: refreshToken),
		expiresAt: parseSlackOAuthExpiry(
			typeof expiresIn === "number" ? expiresIn : undefined,
		),
	});

	lastTokenPatch = configPatch;
	return { accessToken, configPatch };
}
