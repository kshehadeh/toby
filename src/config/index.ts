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

interface AzureAdCredentials {
	tenantId: string;
	clientId: string;
	clientSecret: string;
}

interface AICredentials {
	openai?: { token: string };
}

export interface CredentialsFile {
	gmail?: GmailCredentials;
	todoist?: TodoistCredentials;
	azuread?: AzureAdCredentials;
	ai?: AICredentials;
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
	if (!creds.gmail) {
		throw new Error(
			"Gmail credentials not found. Add them to ~/.toby/credentials.json",
		);
	}
	if (!creds.gmail.clientId || !creds.gmail.clientSecret) {
		throw new Error(
			"Gmail credentials are incomplete. Ensure clientId and clientSecret are set in ~/.toby/credentials.json",
		);
	}
	return creds.gmail;
}

export function getTodoistCredentials(): TodoistCredentials {
	const creds = readCredentials();
	if (!creds.todoist?.apiKey) {
		throw new Error(
			"Todoist API key not found. Add it to ~/.toby/credentials.json or run `toby configure`.",
		);
	}
	return creds.todoist;
}

export function getAzureAdCredentials(): AzureAdCredentials {
	const creds = readCredentials();
	const azuread = creds.azuread;
	if (!azuread) {
		throw new Error(
			"Azure AD credentials not found. Add them to ~/.toby/credentials.json or run `toby configure`.",
		);
	}
	if (!azuread.tenantId || !azuread.clientId || !azuread.clientSecret) {
		throw new Error(
			"Azure AD credentials are incomplete. Ensure tenantId, clientId, and clientSecret are set in ~/.toby/credentials.json or via `toby configure`.",
		);
	}
	return azuread;
}
