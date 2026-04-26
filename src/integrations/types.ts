import type { Command } from "commander";
import type { CoreMessage } from "../ai/chat";
import type { CredentialsFile, Persona } from "../config/index";

export interface IntegrationToolHealth {
	readonly tool: string;
	readonly ok: boolean;
	readonly details: string;
}

export interface IntegrationHealth {
	readonly ok: boolean;
	readonly details: string;
	readonly tools?: IntegrationToolHealth[];
}

/** Capabilities an integration may expose for the resource center / CLI. */
export type IntegrationCapability = "summarize" | "organize" | "chat";

/** Single credential field shown in configure UI (flat key namespace). */
export interface CredentialFieldDescriptor {
	readonly key: string;
	readonly label: string;
	readonly masked?: boolean;
	readonly multiline?: boolean;
}

export interface SummarizeRunOptions {
	readonly maxResults: number;
	readonly summaryPersona: Persona | undefined;
	readonly personaForModel: Persona;
}

export type SummarizeRunResult =
	| { readonly status: "ok"; readonly messages: CoreMessage[] }
	| { readonly status: "empty"; readonly message: string };

/** Options for the `chat` command: freeform instruction + AI persona context. */
export interface ChatRunOptions {
	readonly prompt: string;
	/** When set, caps bootstrap fetches and Gmail list page size. Omitted = no artificial cap (provider / pagination limits still apply). */
	readonly maxResults?: number;
	readonly dryRun: boolean;
	readonly personaForModel: Persona;
}

/** Lifecycle + plugin hooks for a first-party integration module. */
export interface Integration {
	readonly name: string;
	readonly displayName: string;
	readonly description: string;
	connect(): Promise<void>;
	isConnected(): Promise<boolean>;
	testConnection(): Promise<IntegrationHealth>;
	disconnect(): Promise<void>;
}

export interface IntegrationModule extends Integration {
	readonly capabilities: ReadonlyArray<IntegrationCapability>;
	/** Optional high-level resources this integration surfaces (for discovery UI). */
	readonly resources?: ReadonlyArray<string>;
	getCredentialDescriptors(): CredentialFieldDescriptor[];
	seedCredentialValues(creds: CredentialsFile): Record<string, string>;
	mergeCredentialsPatch(
		values: Record<string, string>,
		previous: CredentialsFile,
	): Partial<CredentialsFile>;
	summarize?(options: SummarizeRunOptions): Promise<SummarizeRunResult>;
	/** Run a tool-calling AI flow for a user-supplied instruction (see `toby chat`). */
	chat?(options: ChatRunOptions): Promise<void>;
	registerCommands?(program: Command): void;
}
