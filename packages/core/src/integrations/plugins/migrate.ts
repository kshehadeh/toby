import {
	type CredentialsFile,
	readConfig,
	readCredentials,
	writeConfig,
	writeCredentials,
} from "../../config/index";

const MIGRATED_PLUGINS = ["azuread", "gmail", "todoist", "jira"] as const;

/** Copy legacy top-level credential blocks into integrations.<name> when empty. */
export function migrateLegacyPluginCredentials(): void {
	const creds = readCredentials();
	let changed = false;
	const integrations = { ...(creds.integrations ?? {}) };

	for (const name of MIGRATED_PLUGINS) {
		const legacy = creds[name as keyof CredentialsFile];
		if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) {
			continue;
		}
		const existing = integrations[name];
		if (existing && Object.keys(existing).length > 0) {
			continue;
		}

		const nextBlock: Record<string, string> = {};
		for (const [key, value] of Object.entries(
			legacy as Record<string, unknown>,
		)) {
			if (value === undefined || value === null) continue;
			nextBlock[key] = String(value);
		}
		if (Object.keys(nextBlock).length === 0) {
			continue;
		}

		integrations[name] = nextBlock;
		changed = true;
	}

	if (changed) {
		writeCredentials({
			...creds,
			integrations,
		});
	}

	migrateLegacyGmailOAuthTokens();
	migrateBraveSearchToWebSearch();
	migrateRetiredIntegrations();
}

/** Rename legacy bravesearch credentials/config to websearch. */
function migrateBraveSearchToWebSearch(): void {
	const creds = readCredentials();
	const integrations = { ...(creds.integrations ?? {}) };
	let credsChanged = false;

	const legacyBrave = integrations.bravesearch;
	const existingWeb = integrations.websearch;
	if (
		legacyBrave &&
		Object.keys(legacyBrave).length > 0 &&
		(!existingWeb || Object.keys(existingWeb).length === 0)
	) {
		integrations.websearch = { ...legacyBrave };
		Reflect.deleteProperty(integrations, "bravesearch");
		credsChanged = true;
	}

	if (credsChanged) {
		writeCredentials({
			...creds,
			integrations,
		});
	}

	const config = readConfig();
	const configIntegrations = config.integrations;
	if (!configIntegrations?.bravesearch) {
		return;
	}

	const nextIntegrations = { ...configIntegrations };
	if (!nextIntegrations.websearch) {
		nextIntegrations.websearch = { ...configIntegrations.bravesearch };
	}
	Reflect.deleteProperty(nextIntegrations, "bravesearch");
	writeConfig({
		...config,
		integrations: nextIntegrations,
	});
}

/** Drop config entries for integrations removed from the product. */
function migrateRetiredIntegrations(): void {
	const config = readConfig();
	const integrations = config.integrations;
	if (!integrations?.applemail) {
		return;
	}

	const nextIntegrations = { ...integrations };
	Reflect.deleteProperty(nextIntegrations, "applemail");
	writeConfig({
		...config,
		integrations: nextIntegrations,
	});
}

/** Move OAuth tokens from config.integrations.gmail into credentials.integrations.gmail. */
function migrateLegacyGmailOAuthTokens(): void {
	const config = readConfig();
	const gmailState = config.integrations?.gmail;
	if (!gmailState || typeof gmailState !== "object") {
		return;
	}

	const accessToken = gmailState.accessToken;
	const refreshToken = gmailState.refreshToken;
	const expiresAt = gmailState.expiresAt;

	if (typeof accessToken !== "string" || typeof refreshToken !== "string") {
		return;
	}

	const creds = readCredentials();
	const existing = { ...(creds.integrations?.gmail ?? {}) };
	let credsChanged = false;

	if (!existing.oauthAccessToken) {
		existing.oauthAccessToken = accessToken;
		credsChanged = true;
	}
	if (!existing.oauthRefreshToken) {
		existing.oauthRefreshToken = refreshToken;
		credsChanged = true;
	}
	if (!existing.oauthExpiresAt && typeof expiresAt === "number") {
		existing.oauthExpiresAt = new Date(expiresAt).toISOString();
		credsChanged = true;
	}

	if (credsChanged) {
		writeCredentials({
			...creds,
			integrations: {
				...(creds.integrations ?? {}),
				gmail: existing,
			},
		});
	}

	const nextGmailState = { ...gmailState };
	let configChanged = false;

	if ("accessToken" in nextGmailState) {
		Reflect.deleteProperty(nextGmailState, "accessToken");
		configChanged = true;
	}
	if ("refreshToken" in nextGmailState) {
		Reflect.deleteProperty(nextGmailState, "refreshToken");
		configChanged = true;
	}
	if ("expiresAt" in nextGmailState) {
		Reflect.deleteProperty(nextGmailState, "expiresAt");
		configChanged = true;
	}

	if (!nextGmailState.connectedAt) {
		nextGmailState.connectedAt = new Date().toISOString();
		configChanged = true;
	}

	if (configChanged) {
		writeConfig({
			...config,
			integrations: {
				...config.integrations,
				gmail: nextGmailState,
			},
		});
	}
}
