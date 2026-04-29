import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function resolveTobyDir(): string {
	const override = process.env.TOBY_DIR?.trim();
	if (override) {
		return override;
	}
	return path.join(os.homedir(), ".toby");
}

export function getConfigPath(): string {
	return path.join(resolveTobyDir(), "config.json");
}

export function getCredentialsPath(): string {
	return path.join(resolveTobyDir(), "credentials.json");
}

export function ensureTobyDir(): void {
	const dir = resolveTobyDir();
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

export function getChatDbPath(): string {
	return path.join(resolveTobyDir(), "chat.sqlite");
}

interface AIProvider {
	provider: string;
	model: string;
}

type PersonaPromptMode = "add" | "replace";

export interface Persona {
	name: string;
	instructions: string;
	promptMode: PersonaPromptMode;
	ai: AIProvider;
}

interface TobyConfig {
	integrations: Record<string, Record<string, unknown>>;
	personas: Persona[];
}

export interface GmailCredentials {
	clientId: string;
	clientSecret: string;
}

interface TodoistCredentials {
	apiKey: string;
}

export type AzureAdAuthMethod = "oauth_pkce" | "client_credentials";

interface AzureAdCredentials {
	tenantId?: string;
	clientId?: string;
	clientSecret?: string;
	redirectUri?: string;
	authMethod?: AzureAdAuthMethod;
	oauthAccessToken?: string;
	oauthRefreshToken?: string;
	oauthExpiresAt?: string;
}

export interface AzureAdResolvedCredentials {
	tenantId: string;
	clientId: string;
	clientSecret?: string;
	redirectUri?: string;
	authMethod: AzureAdAuthMethod;
	oauthAccessToken?: string;
	oauthRefreshToken?: string;
	oauthExpiresAt?: string;
}

interface AICredentials {
	openai?: { token: string };
}

export interface CredentialsFile {
	/**
	 * Module-extensible credentials bag. Integrations should prefer storing under
	 * `integrations[<moduleName>]` to avoid hardcoding top-level keys.
	 */
	integrations?: Record<string, Record<string, string>>;
	gmail?: GmailCredentials;
	todoist?: TodoistCredentials;
	azuread?: AzureAdCredentials;
	ai?: AICredentials;
}

function getIntegrationCredential(
	creds: CredentialsFile,
	moduleName: string,
	field: string,
): string | undefined {
	const v = creds.integrations?.[moduleName]?.[field];
	return typeof v === "string" && v.trim() ? v : undefined;
}

export function readConfig(): TobyConfig {
	const configPath = getConfigPath();
	ensureTobyDir();
	if (!fs.existsSync(configPath)) {
		return { integrations: {}, personas: [] };
	}
	const raw = fs.readFileSync(configPath, "utf-8");
	const parsed = JSON.parse(raw) as Partial<TobyConfig>;
	const personas: Persona[] = (parsed.personas ?? []).map((persona) => {
		const promptMode: PersonaPromptMode =
			persona.promptMode === "replace" ? "replace" : "add";
		return {
			...persona,
			promptMode,
		};
	});
	return {
		integrations: parsed.integrations ?? {},
		personas,
	};
}

export function writeConfig(config: TobyConfig): void {
	const configPath = getConfigPath();
	ensureTobyDir();
	fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function writeCredentials(creds: CredentialsFile): void {
	const credentialsPath = getCredentialsPath();
	ensureTobyDir();
	fs.writeFileSync(credentialsPath, JSON.stringify(creds, null, 2));
}

export function readCredentials(): CredentialsFile {
	const credentialsPath = getCredentialsPath();
	if (!fs.existsSync(credentialsPath)) {
		return {};
	}
	const raw = fs.readFileSync(credentialsPath, "utf-8");
	return JSON.parse(raw) as CredentialsFile;
}

export function getGmailCredentials(): GmailCredentials {
	const creds = readCredentials();
	const clientId =
		getIntegrationCredential(creds, "gmail", "clientId") ??
		creds.gmail?.clientId;
	const clientSecret =
		getIntegrationCredential(creds, "gmail", "clientSecret") ??
		creds.gmail?.clientSecret;
	if (!clientId || !clientSecret) {
		throw new Error(
			"Gmail credentials not found. Add them to ~/.toby/credentials.json",
		);
	}
	return { clientId, clientSecret };
}

export function getTodoistCredentials(): TodoistCredentials {
	const creds = readCredentials();
	const apiKey =
		getIntegrationCredential(creds, "todoist", "apiKey") ??
		creds.todoist?.apiKey;
	if (!apiKey) {
		throw new Error(
			"Todoist API key not found. Add it to ~/.toby/credentials.json or run `toby configure`.",
		);
	}
	return { apiKey };
}

export function getAzureAdCredentials(): AzureAdResolvedCredentials {
	const creds = readCredentials();
	const tenantId =
		getIntegrationCredential(creds, "azuread", "tenantId") ??
		creds.azuread?.tenantId;
	const clientId =
		getIntegrationCredential(creds, "azuread", "clientId") ??
		creds.azuread?.clientId;
	const clientSecret =
		getIntegrationCredential(creds, "azuread", "clientSecret") ??
		creds.azuread?.clientSecret;
	const redirectUri =
		getIntegrationCredential(creds, "azuread", "redirectUri") ??
		creds.azuread?.redirectUri;
	const authMethodRaw =
		getIntegrationCredential(creds, "azuread", "authMethod") ??
		creds.azuread?.authMethod;
	const oauthAccessToken =
		getIntegrationCredential(creds, "azuread", "oauthAccessToken") ??
		creds.azuread?.oauthAccessToken;
	const oauthRefreshToken =
		getIntegrationCredential(creds, "azuread", "oauthRefreshToken") ??
		creds.azuread?.oauthRefreshToken;
	const oauthExpiresAt =
		getIntegrationCredential(creds, "azuread", "oauthExpiresAt") ??
		creds.azuread?.oauthExpiresAt;

	if (!tenantId || !clientId) {
		throw new Error(
			"Azure AD credentials are incomplete. Ensure tenantId and clientId are set in ~/.toby/credentials.json or via `toby configure`.",
		);
	}
	const authMethod = getAzureAdAuthMethod(creds, authMethodRaw, clientSecret);
	if (authMethod === "client_credentials" && !clientSecret) {
		throw new Error(
			"Azure AD client-credentials auth requires clientSecret. Set it in `toby configure`.",
		);
	}
	return {
		tenantId,
		clientId,
		clientSecret,
		redirectUri,
		authMethod,
		oauthAccessToken,
		oauthRefreshToken,
		oauthExpiresAt,
	};
}

export function getAzureAdAuthMethod(
	creds: CredentialsFile,
	explicitMethod?: string,
	clientSecretHint?: string,
): AzureAdAuthMethod {
	const authMethod =
		explicitMethod ??
		getIntegrationCredential(creds, "azuread", "authMethod") ??
		creds.azuread?.authMethod;
	if (authMethod === "oauth_pkce" || authMethod === "client_credentials") {
		return authMethod;
	}

	const clientSecret =
		clientSecretHint ??
		getIntegrationCredential(creds, "azuread", "clientSecret") ??
		creds.azuread?.clientSecret;
	return clientSecret?.trim() ? "client_credentials" : "oauth_pkce";
}
