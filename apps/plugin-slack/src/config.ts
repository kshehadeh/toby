type JsonRecord = Record<string, unknown>;

export type SlackAuthMethod = "oauth" | "bot_token";

const CONFIG_FIELDS = [
	"authMethod",
	"clientId",
	"clientSecret",
	"redirectUri",
	"botToken",
	"appToken",
	"botUserId",
	"oauthBotToken",
	"oauthUserToken",
	"oauthUserRefreshToken",
	"oauthBotRefreshToken",
	"oauthExpiresAt",
	"teamId",
	"teamName",
] as const;

export type SlackConfigField = (typeof CONFIG_FIELDS)[number];

export function getConfigField(
	config: JsonRecord,
	field: SlackConfigField,
): string | undefined {
	const value = config[field];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function getSlackAuthMethod(
	config: JsonRecord,
	explicitMethod?: string,
	botTokenHint?: string,
): SlackAuthMethod {
	const authMethod = explicitMethod ?? getConfigField(config, "authMethod");
	if (authMethod === "oauth" || authMethod === "bot_token") {
		return authMethod;
	}
	const botToken = botTokenHint ?? getConfigField(config, "botToken");
	return botToken ? "bot_token" : "oauth";
}

export function normalizeConfig(raw: JsonRecord): JsonRecord {
	const out: JsonRecord = {};
	for (const field of CONFIG_FIELDS) {
		out[field] = getConfigField(raw, field) ?? "";
	}
	return out;
}

export function hasSlackAccessToken(config: JsonRecord): boolean {
	return Boolean(
		getConfigField(config, "botToken") ||
			getConfigField(config, "oauthBotToken") ||
			getConfigField(config, "oauthUserToken"),
	);
}

export function hasSlackOAuthClientCreds(config: JsonRecord): boolean {
	return Boolean(
		getConfigField(config, "clientId") &&
			getConfigField(config, "clientSecret"),
	);
}

export function isConnected(config: JsonRecord, state: JsonRecord): boolean {
	return Boolean(state.connectedAt) || hasSlackAccessToken(config);
}

export interface SlackResolvedCredentials {
	readonly authMethod: SlackAuthMethod;
	readonly clientId?: string;
	readonly clientSecret?: string;
	readonly redirectUri?: string;
	readonly botToken: string;
	readonly oauthUserToken?: string;
	readonly oauthExpiresAt?: string;
	readonly teamId?: string;
	readonly teamName?: string;
}

export function getSlackCredentials(
	config: JsonRecord,
): SlackResolvedCredentials {
	const authMethod = getSlackAuthMethod(config);
	const clientId = getConfigField(config, "clientId");
	const clientSecret = getConfigField(config, "clientSecret");
	const redirectUri = getConfigField(config, "redirectUri");
	const manualBotToken = getConfigField(config, "botToken");
	const oauthBotToken = getConfigField(config, "oauthBotToken");
	const oauthUserToken = getConfigField(config, "oauthUserToken");
	const teamId = getConfigField(config, "teamId");
	const teamName = getConfigField(config, "teamName");
	const oauthExpiresAt = getConfigField(config, "oauthExpiresAt");

	const botToken =
		authMethod === "bot_token"
			? manualBotToken
			: oauthUserToken || oauthBotToken || manualBotToken;

	if (!botToken) {
		throw new Error(
			authMethod === "bot_token"
				? "Slack bot token not found. Add it via `toby configure` or run `toby connect slack`."
				: "Slack is not authenticated. Configure OAuth client credentials and run `toby connect slack`, or switch to manual bot token auth in configure.",
		);
	}

	return {
		authMethod,
		clientId,
		clientSecret,
		redirectUri,
		botToken,
		oauthUserToken,
		oauthExpiresAt,
		teamId,
		teamName,
	};
}
