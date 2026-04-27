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

export function ensureTobyDir(): void {
	const dir = resolveTobyDir();
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

export function getChatDbPath(): string {
	return path.join(resolveTobyDir(), "chat.sqlite");
}

const CONFIG_PATH = path.join(resolveTobyDir(), "config.json");
const CREDENTIALS_PATH = path.join(resolveTobyDir(), "credentials.json");

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
	ensureTobyDir();
	if (!fs.existsSync(CONFIG_PATH)) {
		return { integrations: {}, personas: [] };
	}
	const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
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
	ensureTobyDir();
	fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function writeCredentials(creds: CredentialsFile): void {
	ensureTobyDir();
	fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(creds, null, 2));
}

export function readCredentials(): CredentialsFile {
	if (!fs.existsSync(CREDENTIALS_PATH)) {
		return {};
	}
	const raw = fs.readFileSync(CREDENTIALS_PATH, "utf-8");
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
