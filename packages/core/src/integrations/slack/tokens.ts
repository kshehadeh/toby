import {
	getSlackAuthMethod,
	readCredentials,
	writeCredentials,
} from "../../config/index";

const SLACK_OAUTH_ACCESS_URL = "https://slack.com/api/oauth.v2.access";

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

export function persistSlackOAuthTokens(params: {
	readonly accessToken: string;
	readonly tokenType: "user" | "bot";
	readonly refreshToken?: string;
	readonly expiresAt?: string;
	readonly teamId?: string;
	readonly teamName?: string;
	readonly clientId?: string;
	readonly clientSecret?: string;
	readonly redirectUri?: string;
}): void {
	const creds = readCredentials();
	const previous = creds.integrations?.slack ?? {};
	const previousTop = creds.slack ?? {};
	const clientId =
		params.clientId ?? previous.clientId ?? previousTop.clientId ?? "";
	const clientSecret =
		params.clientSecret ??
		previous.clientSecret ??
		previousTop.clientSecret ??
		"";
	const redirectUri =
		params.redirectUri ?? previous.redirectUri ?? previousTop.redirectUri ?? "";
	const authMethod = getSlackAuthMethod(creds);

	const slackPatch = {
		...(creds.integrations?.slack ?? {}),
		authMethod,
		clientId,
		clientSecret,
		redirectUri,
		teamId: params.teamId ?? previous.teamId ?? previousTop.teamId ?? "",
		teamName:
			params.teamName ?? previous.teamName ?? previousTop.teamName ?? "",
		oauthExpiresAt:
			params.expiresAt ??
			previous.oauthExpiresAt ??
			previousTop.oauthExpiresAt ??
			"",
		oauthUserToken:
			params.tokenType === "user"
				? params.accessToken
				: (previous.oauthUserToken ?? previousTop.oauthUserToken ?? ""),
		oauthBotToken:
			params.tokenType === "bot"
				? params.accessToken
				: (previous.oauthBotToken ?? previousTop.oauthBotToken ?? ""),
		oauthUserRefreshToken:
			params.tokenType === "user" && params.refreshToken
				? params.refreshToken
				: (previous.oauthUserRefreshToken ??
					previousTop.oauthUserRefreshToken ??
					""),
		oauthBotRefreshToken:
			params.tokenType === "bot" && params.refreshToken
				? params.refreshToken
				: (previous.oauthBotRefreshToken ??
					previousTop.oauthBotRefreshToken ??
					""),
	};

	writeCredentials({
		...creds,
		integrations: {
			...(creds.integrations ?? {}),
			slack: slackPatch,
		},
		slack: {
			...(creds.slack ?? {}),
			authMethod,
			clientId,
			clientSecret,
			redirectUri,
			teamId: slackPatch.teamId,
			teamName: slackPatch.teamName,
			oauthExpiresAt: slackPatch.oauthExpiresAt,
			oauthUserToken: slackPatch.oauthUserToken,
			oauthBotToken: slackPatch.oauthBotToken,
			oauthUserRefreshToken: slackPatch.oauthUserRefreshToken,
			oauthBotRefreshToken: slackPatch.oauthBotRefreshToken,
		},
	});
}

export async function refreshSlackOAuthAccessToken(): Promise<string> {
	const creds = readCredentials();
	const authMethod = getSlackAuthMethod(creds);
	if (authMethod === "bot_token") {
		throw new Error(
			"Slack bot tokens cannot be refreshed automatically. Add a new token in `toby configure` or reconnect with OAuth.",
		);
	}

	const clientId =
		creds.integrations?.slack?.clientId?.trim() ||
		creds.slack?.clientId?.trim();
	if (!clientId) {
		throw new Error(
			"Slack OAuth client ID is missing. Set credentials in `toby configure`.",
		);
	}

	const userRefresh =
		creds.integrations?.slack?.oauthUserRefreshToken?.trim() ||
		creds.slack?.oauthUserRefreshToken?.trim();
	const botRefresh =
		creds.integrations?.slack?.oauthBotRefreshToken?.trim() ||
		creds.slack?.oauthBotRefreshToken?.trim();
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

	persistSlackOAuthTokens({
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

	return accessToken;
}
