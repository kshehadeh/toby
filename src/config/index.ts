import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TOBY_DIR = path.join(os.homedir(), ".toby");
const CONFIG_PATH = path.join(TOBY_DIR, "config.json");
const CREDENTIALS_PATH = path.join(TOBY_DIR, "credentials.json");

interface AIProvider {
	provider: string;
	model: string;
}

export interface Persona {
	name: string;
	instructions: string;
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

interface AICredentials {
	openai?: { token: string };
}

export interface CredentialsFile {
	gmail?: GmailCredentials;
	todoist?: TodoistCredentials;
	ai?: AICredentials;
}

function ensureDir(): void {
	if (!fs.existsSync(TOBY_DIR)) {
		fs.mkdirSync(TOBY_DIR, { recursive: true });
	}
}

export function readConfig(): TobyConfig {
	ensureDir();
	if (!fs.existsSync(CONFIG_PATH)) {
		return { integrations: {}, personas: [] };
	}
	const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
	const parsed = JSON.parse(raw) as Partial<TobyConfig>;
	return {
		integrations: parsed.integrations ?? {},
		personas: parsed.personas ?? [],
	};
}

export function writeConfig(config: TobyConfig): void {
	ensureDir();
	fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function writeCredentials(creds: CredentialsFile): void {
	ensureDir();
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
