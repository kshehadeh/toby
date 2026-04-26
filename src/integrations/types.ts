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
export type IntegrationCapability = "summarize" | "organize";

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
	registerCommands?(program: Command): void;
}
