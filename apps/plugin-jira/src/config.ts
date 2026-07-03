type JsonRecord = Record<string, unknown>;

export type JiraAuthMethod = "oauth" | "api_token";

const CONFIG_FIELDS = [
	"authMethod",
	"clientId",
	"clientSecret",
	"redirectUri",
	"oauthAccessToken",
	"oauthRefreshToken",
	"oauthExpiresAt",
	"cloudId",
	"siteName",
	"siteUrl",
	"domain",
	"email",
	"apiToken",
] as const;

export type JiraConfigField = (typeof CONFIG_FIELDS)[number];

export function getConfigField(
	config: JsonRecord,
	field: JiraConfigField,
): string | undefined {
	const value = config[field];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function getJiraAuthMethod(
	config: JsonRecord,
	explicitMethod?: string,
): JiraAuthMethod {
	const authMethod = explicitMethod ?? getConfigField(config, "authMethod");
	if (authMethod === "oauth" || authMethod === "api_token") {
		return authMethod;
	}
	// Backward compat: if domain+email+apiToken are present, assume api_token
	const domain = getConfigField(config, "domain");
	const apiToken = getConfigField(config, "apiToken");
	if (domain && apiToken) {
		return "api_token";
	}
	return "oauth";
}

export function normalizeConfig(raw: JsonRecord): JsonRecord {
	const out: JsonRecord = {};
	for (const field of CONFIG_FIELDS) {
		out[field] = getConfigField(raw, field) ?? "";
	}
	return out;
}

export function hasJiraApiTokenCredentials(config: JsonRecord): boolean {
	return jiraApiTokenCredentials(config) !== null;
}

export function jiraApiTokenCredentials(
	config: JsonRecord,
): { domain: string; email: string; apiToken: string } | null {
	const domain = getConfigField(config, "domain");
	const email = getConfigField(config, "email");
	const apiToken = getConfigField(config, "apiToken");
	if (!domain || !email || !apiToken) return null;
	return { domain, email, apiToken };
}

export function hasJiraOAuthToken(config: JsonRecord): boolean {
	return Boolean(getConfigField(config, "oauthAccessToken"));
}

export function hasJiraOAuthClientCreds(config: JsonRecord): boolean {
	return Boolean(getConfigField(config, "clientId"));
}

export function hasCredentials(config: JsonRecord): boolean {
	return hasJiraApiTokenCredentials(config) || hasJiraOAuthToken(config);
}

export function isConnected(config: JsonRecord, state: JsonRecord): boolean {
	return Boolean(state.connectedAt) || hasCredentials(config);
}

export interface JiraResolvedCredentials {
	readonly authMethod: JiraAuthMethod;
	readonly clientId?: string;
	readonly clientSecret?: string;
	readonly redirectUri?: string;
	readonly oauthAccessToken?: string;
	readonly oauthRefreshToken?: string;
	readonly oauthExpiresAt?: string;
	readonly cloudId?: string;
	readonly siteName?: string;
	readonly siteUrl?: string;
	readonly domain?: string;
	readonly email?: string;
	readonly apiToken?: string;
}

export function getJiraCredentials(
	config: JsonRecord,
): JiraResolvedCredentials {
	const authMethod = getJiraAuthMethod(config);
	const clientId = getConfigField(config, "clientId");
	const clientSecret = getConfigField(config, "clientSecret");
	const redirectUri = getConfigField(config, "redirectUri");
	const oauthAccessToken = getConfigField(config, "oauthAccessToken");
	const oauthRefreshToken = getConfigField(config, "oauthRefreshToken");
	const oauthExpiresAt = getConfigField(config, "oauthExpiresAt");
	const cloudId = getConfigField(config, "cloudId");
	const siteName = getConfigField(config, "siteName");
	const siteUrl = getConfigField(config, "siteUrl");
	const domain = getConfigField(config, "domain");
	const email = getConfigField(config, "email");
	const apiToken = getConfigField(config, "apiToken");

	if (authMethod === "oauth") {
		if (!oauthAccessToken) {
			throw new Error(
				"Jira is not authenticated. Configure OAuth client ID in `toby configure` and run `toby connect jira`.",
			);
		}
	} else {
		if (!domain || !email || !apiToken) {
			throw new Error(
				"Jira credentials not found. Add domain, email, and API token in `toby configure`, or switch to OAuth auth method.",
			);
		}
	}

	return {
		authMethod,
		clientId,
		clientSecret,
		redirectUri,
		oauthAccessToken,
		oauthRefreshToken,
		oauthExpiresAt,
		cloudId,
		siteName,
		siteUrl,
		domain,
		email,
		apiToken,
	};
}
