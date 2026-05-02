import type { Tool } from "ai";
import type { LanguageModelUsage, ProviderMetadata } from "ai";
import type { Command } from "commander";
import type { AskUserHandler } from "../ai/ask-user-tool";
import type { CoreMessage } from "../ai/chat";
import type { ChatWithToolsOptions } from "../ai/chat";
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
	readonly kind?: "value" | "select";
	readonly options?: ReadonlyArray<string>;
	/** Optional auth-method gating for configure UI. */
	readonly showForAuthMethods?: ReadonlyArray<string>;
	readonly masked?: boolean;
	readonly multiline?: boolean;
}

interface IntegrationAuthMethodDescriptor {
	readonly id: string;
	readonly label: string;
	readonly isDefault?: boolean;
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

interface ChatModelPrep {
	/** A short, integration-specific block to append to the combined system prompt. */
	readonly systemPromptSection: string;
	/** Single-integration boot messages for TUI chat sessions. */
	buildSingleSessionMessages(
		persona: Persona,
		userPrompt: string,
	): Promise<CoreMessage[]>;
	/** Multi-integration: a user-content section providing context/instructions for this integration. */
	buildMultiUserContent(userPrompt: string): Promise<string>;
}

interface ChatIntegrationReadiness {
	/** True when the integration can participate in chat selection/routing. */
	readonly ok: boolean;
	/** Optional user-facing guidance to make it ready (configure/connect steps). */
	readonly hint?: string;
}

interface IntegrationChatTools {
	/** Tool definitions for this integration (without `askUser`; shared runner will wrap it). */
	readonly tools: Record<string, Tool>;
	/** Accumulates side-effect summaries (push strings into this array). */
	readonly appliedActions: string[];
}

interface IntegrationChatTurnParams {
	readonly messages: CoreMessage[];
	readonly persona: Persona;
	readonly dryRun: boolean;
	readonly maxResults?: number;
	readonly askUser?: AskUserHandler;
	readonly chatWithToolsOptions?: ChatWithToolsOptions;
}

interface IntegrationChatTurnResult {
	readonly text: string;
	readonly toolCalls: { name: string; args: Record<string, unknown> }[];
	readonly appliedActions: string[];
	readonly responseMessages: CoreMessage[];
	readonly usage?: LanguageModelUsage;
	readonly providerMetadata?: ProviderMetadata;
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
	/** Optional auth methods supported by this integration. */
	readonly authMethods?: ReadonlyArray<IntegrationAuthMethodDescriptor>;
	/** Optional high-level resources this integration surfaces (for discovery UI). */
	readonly resources?: ReadonlyArray<string>;
	/** Model-prep for the Ink TUI chat flow (replaces hardcoded integration checks). */
	readonly chatModelPrep?: ChatModelPrep;
	/**
	 * Whether this integration is usable in chat selection (picker + defaults).
	 * Default behavior should typically be "connected implies usable", but some integrations
	 * may be configure-only (no `connect` step) and can override this.
	 */
	readonly chatReadiness?: (
		creds: CredentialsFile,
	) => Promise<ChatIntegrationReadiness>;
	/**
	 * Provide tools + action accumulator for shared chat turn runners (combined chat flow).
	 * This replaces hardcoded imports/branches for tool wiring.
	 */
	readonly createChatTools?: (params: {
		readonly dryRun: boolean;
		readonly maxResults?: number;
	}) => Promise<IntegrationChatTools> | IntegrationChatTools;
	/**
	 * Run a tool-calling model turn for this integration using shared runner infrastructure.
	 * If omitted, shared routing can fall back to `createChatTools` + `chatWithTools`.
	 */
	readonly runChatTurn?: (
		params: IntegrationChatTurnParams,
	) => Promise<IntegrationChatTurnResult>;
	/** Optional organize runner (capability-gated by `capabilities`). */
	readonly organize?: (params: {
		readonly maxResults: number;
		readonly dryRun: boolean;
		readonly personaForModel: Persona;
	}) => Promise<void>;
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
