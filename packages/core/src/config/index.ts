import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function resolveTobyDir(): string {
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

export function getMemoryDbPath(): string {
	return path.join(resolveTobyDir(), "memory.sqlite");
}

/** Directory holding unified log files: `~/.toby/logs/`. */
export function getLogsDir(): string {
	return path.join(resolveTobyDir(), "logs");
}

/** Ensure the `~/.toby/logs/` directory exists. */
export function ensureLogsDir(): void {
	const dir = getLogsDir();
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

/**
 * Unified JSON-lines log file. All Toby subsystems (chat, daemon, server
 * events, upgrade, native-app, macOS plugin) append entries with a `source`
 * discriminator to this single file.
 */
export function getUnifiedLogPath(): string {
	return path.join(getLogsDir(), "toby.log");
}

/** Persona images: `~/.toby/persona/images/<filename>`. */
export function getPersonaImagesDir(): string {
	return path.join(resolveTobyDir(), "persona", "images");
}

/** Ensure the persona images directory exists. */
export function ensurePersonaImagesDir(): void {
	const dir = getPersonaImagesDir();
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

/** Resolve the absolute path for a persona image stored by relative filename. */
export function resolvePersonaImagePath(imagePath: string): string {
	return path.join(getPersonaImagesDir(), imagePath);
}

/** Path to the bundled default persona image. */
export function getDefaultPersonaImagePath(): string {
	return path.join(getPersonaImagesDir(), "default.png");
}

/**
 * Ensure the default persona image exists in `~/.toby/persona/images/default.png`.
 * Copies from the app's bundled assets if missing.
 */
export function ensureDefaultPersonaImage(bundledAssetPath: string): void {
	ensurePersonaImagesDir();
	const dest = getDefaultPersonaImagePath();
	if (!fs.existsSync(dest) && fs.existsSync(bundledAssetPath)) {
		fs.copyFileSync(bundledAssetPath, dest);
	}
}

export function getSkillsDir(): string {
	return path.join(resolveTobyDir(), "skills");
}

/** User-managed installable plugins: `~/.toby/plugins/toby-plugin-<name>`. */
export function getPluginsDir(): string {
	return path.join(resolveTobyDir(), "plugins");
}

/** Local projects: `~/.toby/projects/<slug>/project.json`. */
export function getProjectsDir(): string {
	return path.join(resolveTobyDir(), "projects");
}

/** Fallback location for `writeTextFile` when no project is active. */
export function getGeneratedFilesDir(): string {
	return path.join(resolveTobyDir(), "generated-files");
}

/** Directory for bundled native helper binaries. */
export function getHelpersDir(): string {
	return path.join(resolveTobyDir(), "helpers");
}

/** Plugin-owned local data directory: `~/.toby/plugins-data/<name>/`. */
export function getPluginDataDir(name: string): string {
	return path.join(resolveTobyDir(), "plugins-data", name);
}

/** Ensure a plugin's local data directory exists and return its path. */
export function ensurePluginDataDir(name: string): string {
	const dir = getPluginDataDir(name);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	return dir;
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
	/** Relative filename of a custom persona image stored in `~/.toby/persona/images/`. */
	imagePath?: string;
}

import type { ProviderCategory } from "../integrations/types";

export interface ChatInboundConfig {
	readonly enabled?: boolean;
	readonly integration?: string;
	readonly persona?: string;
}

export interface TranscriptionConfig {
	readonly provider: string;
	readonly model: string;
}

export interface WebSearchConfig {
	readonly provider: string;
	readonly enabled: boolean;
}

export interface WebConfig {
	readonly enabled?: boolean;
	readonly port?: number;
}

/** Non-secret AI provider settings persisted in config.json. */
export interface AISettings {
	readonly ollama?: { readonly baseUrl?: string };
	/** User-added model names per provider id, shown alongside built-in models. */
	readonly customModels?: Record<string, string[]>;
}

interface TobyConfig {
	integrations: Record<string, Record<string, unknown>>;
	personas: Persona[];
	defaultPersona?: string;
	defaultProviders?: Partial<Record<ProviderCategory, string>>;
	chatInbound?: ChatInboundConfig;
	transcription?: TranscriptionConfig;
	webSearch?: WebSearchConfig;
	web?: WebConfig;
	ai?: AISettings;
	/** Slug of the currently active project (see `~/.toby/projects/<slug>/`). */
	activeProject?: string;
}

interface AICredentials {
	openai?: { token: string };
	vercel?: { apiKey: string };
	ollama?: { apiKey?: string };
	chutes?: { apiKey: string };
	openrouter?: { apiKey: string };
}

type SlackAuthMethod = "oauth" | "bot_token";

interface SlackCredentials {
	clientId?: string;
	clientSecret?: string;
	redirectUri?: string;
	authMethod?: SlackAuthMethod;
	botToken?: string;
	oauthBotToken?: string;
	oauthUserToken?: string;
	oauthUserRefreshToken?: string;
	oauthBotRefreshToken?: string;
	oauthExpiresAt?: string;
	teamId?: string;
	teamName?: string;
	appToken?: string;
	botUserId?: string;
}

export interface CredentialsFile {
	/**
	 * Module-extensible credentials bag. Integrations should prefer storing under
	 * `integrations[<moduleName>]` to avoid hardcoding top-level keys.
	 */
	integrations?: Record<string, Record<string, string>>;
	/** Legacy Todoist block; migrated to integrations.todoist on plugin load. */
	todoist?: Record<string, string>;
	slack?: SlackCredentials;
	ai?: AICredentials;
	/** Per-provider API keys for built-in transcription (e.g. { groq: { apiKey } }). */
	transcription?: Record<string, { apiKey: string }>;
}

export function getIntegrationCredential(
	creds: CredentialsFile,
	moduleName: string,
	field: string,
): string | undefined {
	const v = creds.integrations?.[moduleName]?.[field];
	return typeof v === "string" && v.trim() ? v : undefined;
}

/** Prefer `integrations.slack`, then legacy top-level `slack`. */
export function getSlackCredentialField(
	creds: CredentialsFile,
	field: keyof SlackCredentials,
): string | undefined {
	return (
		getIntegrationCredential(creds, "slack", field) ??
		(typeof creds.slack?.[field] === "string" && creds.slack[field]?.trim()
			? creds.slack[field].trim()
			: undefined)
	);
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
		defaultPersona: parsed.defaultPersona,
		defaultProviders: parsed.defaultProviders,
		chatInbound: parsed.chatInbound,
		transcription: parsed.transcription,
		webSearch: parsed.webSearch,
		web: parsed.web,
		ai: parsed.ai,
		activeProject: parsed.activeProject,
	};
}

export const DEFAULT_WEB_PORT = 7847;

export function getWebConfig(): { enabled: boolean; port: number } {
	const config = readConfig();
	return {
		enabled: config.web?.enabled !== false,
		port: config.web?.port ?? DEFAULT_WEB_PORT,
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

export type { SlackAuthMethod };

export function getSlackAuthMethod(
	creds: CredentialsFile,
	explicitMethod?: string,
	botTokenHint?: string,
): SlackAuthMethod {
	const authMethod =
		explicitMethod ??
		getIntegrationCredential(creds, "slack", "authMethod") ??
		creds.slack?.authMethod;
	if (authMethod === "oauth" || authMethod === "bot_token") {
		return authMethod;
	}
	const botToken =
		botTokenHint ??
		getIntegrationCredential(creds, "slack", "botToken") ??
		creds.slack?.botToken;
	return botToken?.trim() ? "bot_token" : "oauth";
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

export function getSlackCredentials(): SlackResolvedCredentials {
	const creds = readCredentials();
	const authMethod = getSlackAuthMethod(creds);
	const clientId =
		getIntegrationCredential(creds, "slack", "clientId") ??
		creds.slack?.clientId;
	const clientSecret =
		getIntegrationCredential(creds, "slack", "clientSecret") ??
		creds.slack?.clientSecret;
	const redirectUri =
		getIntegrationCredential(creds, "slack", "redirectUri") ??
		creds.slack?.redirectUri;
	const manualBotToken =
		getIntegrationCredential(creds, "slack", "botToken") ??
		creds.slack?.botToken;
	const oauthBotToken =
		getIntegrationCredential(creds, "slack", "oauthBotToken") ??
		creds.slack?.oauthBotToken;
	const oauthUserToken =
		getIntegrationCredential(creds, "slack", "oauthUserToken") ??
		creds.slack?.oauthUserToken;
	const teamId =
		getIntegrationCredential(creds, "slack", "teamId") ?? creds.slack?.teamId;
	const teamName =
		getIntegrationCredential(creds, "slack", "teamName") ??
		creds.slack?.teamName;
	const oauthExpiresAt =
		getIntegrationCredential(creds, "slack", "oauthExpiresAt") ??
		creds.slack?.oauthExpiresAt;

	const botToken =
		authMethod === "bot_token"
			? manualBotToken?.trim()
			: oauthUserToken?.trim() ||
				oauthBotToken?.trim() ||
				manualBotToken?.trim();

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
		oauthUserToken: oauthUserToken?.trim() || undefined,
		oauthExpiresAt: oauthExpiresAt?.trim() || undefined,
		teamId,
		teamName,
	};
}

export function getDefaultProvider(
	category: ProviderCategory,
): string | undefined {
	const cfg = readConfig();
	return cfg.defaultProviders?.[category];
}

export function setDefaultProvider(
	category: ProviderCategory,
	integrationName: string,
): void {
	const cfg = readConfig();
	if (!cfg.defaultProviders) {
		cfg.defaultProviders = {};
	}
	cfg.defaultProviders[category] = integrationName;
	writeConfig(cfg);
}

export function getDefaultPersonaName(): string | undefined {
	return readConfig().defaultPersona;
}

export function setDefaultPersona(personaName: string): void {
	const cfg = readConfig();
	cfg.defaultPersona = personaName;
	writeConfig(cfg);
}

export function clearDefaultPersona(): void {
	const cfg = readConfig();
	cfg.defaultPersona = undefined;
	writeConfig(cfg);
}

export function getActiveProjectSlug(): string | undefined {
	return readConfig().activeProject;
}

export function setActiveProjectSlug(slug: string): void {
	const cfg = readConfig();
	cfg.activeProject = slug;
	writeConfig(cfg);
}

export function clearActiveProjectSlug(): void {
	const cfg = readConfig();
	cfg.activeProject = undefined;
	writeConfig(cfg);
}
