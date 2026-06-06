import type { Tool } from "ai";
import type { Command } from "commander";
import type { CoreMessage } from "../ai/chat";
import type { ChatInboundProvider } from "../chat-inbound/types";
import type { CredentialsFile, Persona } from "../config/index";

export type {
	ChatInboundProvider,
	InboundChatEvent,
	InboundConversation,
} from "../chat-inbound/types";

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

/** Options for {@link Integration.testConnection}. */
export type TestConnectionOptions = {
	/** When true, run per-tool probes (e.g. Apple Mail AppleScript searches). */
	readonly validateTools?: boolean;
};

/** Capabilities an integration may expose for the resource center / CLI. */
export type IntegrationCapability = "chat";

/** Provider categories an integration may belong to (used for default-provider selection). */
export type ProviderCategory =
	| "email"
	| "calendar"
	| "tasks"
	| "contacts"
	| "chat"
	| "search"
	| "work_tracker";

export const PROVIDER_CATEGORY_LABELS: Record<ProviderCategory, string> = {
	email: "Email Provider",
	calendar: "Calendar Provider",
	tasks: "Task List Provider",
	contacts: "Contact List Provider",
	chat: "Chat Provider",
	search: "Search Provider",
	work_tracker: "Work Tracker",
};

export const ALL_PROVIDER_CATEGORIES: readonly ProviderCategory[] = [
	"email",
	"calendar",
	"tasks",
	"contacts",
	"chat",
	"search",
	"work_tracker",
];

/** Single credential field shown in configure UI (flat key namespace). */
export interface CredentialFieldDescriptor {
	readonly key: string;
	readonly label: string;
	readonly kind?: "value" | "select";
	readonly options?: ReadonlyArray<string>;
	/** Optional auth-method gating for configure UI. */
	readonly showForAuthMethods?: ReadonlyArray<string>;
	/** Shown when daemon/inbound is enabled for this integration (even if auth method differs). */
	readonly showForInbound?: boolean;
	readonly masked?: boolean;
	readonly multiline?: boolean;
}

interface IntegrationAuthMethodDescriptor {
	readonly id: string;
	readonly label: string;
	readonly isDefault?: boolean;
}

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

export interface ChatIntegrationReadiness {
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

/** Lifecycle + plugin hooks for a first-party integration module. */
export interface Integration {
	readonly name: string;
	readonly displayName: string;
	readonly description: string;
	connect(): Promise<void>;
	isConnected(): Promise<boolean>;
	testConnection(options?: TestConnectionOptions): Promise<IntegrationHealth>;
	disconnect(): Promise<void>;
}

export interface IntegrationModule extends Integration {
	readonly capabilities: ReadonlyArray<IntegrationCapability>;
	/** Provider categories this integration belongs to (e.g. "email", "tasks"). */
	readonly providerCategories?: ReadonlyArray<ProviderCategory>;
	/** Optional auth methods supported by this integration. */
	readonly authMethods?: ReadonlyArray<IntegrationAuthMethodDescriptor>;
	/**
	 * Shown in Configure when the integration has no editable settings (e.g.
	 * local-only integrations with no API keys).
	 */
	readonly configureHint?: string;
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
	getCredentialDescriptors(): CredentialFieldDescriptor[];
	seedCredentialValues(creds: CredentialsFile): Record<string, string>;
	mergeCredentialsPatch(
		values: Record<string, string>,
		previous: CredentialsFile,
	): Partial<CredentialsFile>;
	/** Run a tool-calling AI flow for a user-supplied instruction (see `toby chat`). */
	chat?(options: ChatRunOptions): Promise<void>;
	/**
	 * Long-lived inbound listener (daemon): maps external channel+thread to chat sessions.
	 * Implementation lives under `src/integrations/<name>/inbound.ts`.
	 */
	readonly chatInbound?: ChatInboundProvider;
	registerCommands?(program: Command): void;
}
