import type { IntegrationCapability, ProviderCategory } from "../types";

/** Supported plugin protocol versions (newest first). */
export const SUPPORTED_PROTOCOL_VERSIONS = ["1"] as const;
export const CURRENT_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export const PLUGIN_BINARY_PREFIX = "toby-plugin-";

export type PluginConfigEnvelope = {
	readonly config?: Record<string, unknown>;
	readonly state?: Record<string, unknown>;
	readonly validateTools?: boolean;
	/** Plugin-owned data directory provided by core for local storage. */
	readonly paths?: { readonly dataDir?: string };
};

export type PluginConfigFieldType = "string" | "number" | "boolean" | "select";

export interface PluginAuthMethodDescriptor {
	readonly id: string;
	readonly label: string;
	readonly isDefault?: boolean;
}

export interface PluginConfigField {
	readonly key: string;
	readonly label: string;
	readonly type: PluginConfigFieldType;
	readonly required?: boolean;
	readonly masked?: boolean;
	readonly multiline?: boolean;
	readonly options?: readonly string[];
	readonly default?: unknown;
	readonly pattern?: string;
	readonly minLength?: number;
	readonly maxLength?: number;
	readonly description?: string;
	readonly showForAuthMethods?: readonly string[];
	readonly showForInbound?: boolean;
}

export interface PluginToolDefinition {
	readonly name: string;
	readonly description: string;
	readonly readOnly?: boolean;
	readonly inputSchema: Record<string, unknown>;
}

export interface PluginToolHealth {
	readonly tool: string;
	readonly ok: boolean;
	readonly details?: string;
}

export interface PluginChatReadiness {
	readonly ok: boolean;
	readonly hint?: string;
}

export interface PluginChatModelPrep {
	readonly systemPromptSection: string;
	readonly singleSessionRules: string;
	readonly singleSessionUserTemplate?: string;
	readonly multiUserContentTemplate: string;
}

/** Optional metadata for daemon inbound transport (when capabilities includes "inbound"). */
export interface PluginInboundPrep {
	readonly externalKeyFormat?: string;
	readonly transportLabel?: string;
}

/** Plugin → core messages on stdout during `inbound run` (one JSON object per line). */
export type PluginInboundToCoreMessage =
	| { readonly type: "ready" }
	| { readonly type: "event"; readonly event: PluginInboundChatEvent }
	| {
			readonly type: "personaAppendix";
			readonly requestId: string;
			readonly text: string;
	  }
	| { readonly type: "error"; readonly message: string };

/** Normalized inbound event emitted by the plugin transport. */
export interface PluginInboundChatEvent {
	readonly integration: string;
	readonly externalKey: string;
	readonly messageId: string;
	readonly text: string;
	readonly authorId: string;
	readonly isNewConversationTurn: boolean;
	readonly conversation: {
		readonly externalKey: string;
		readonly displayName: string;
		readonly metadata: Record<string, unknown>;
	};
	readonly botUserId?: string;
}

/** Core → plugin messages on stdin during `inbound run` (one JSON object per line). */
export type PluginInboundFromCoreMessage =
	| {
			readonly type: "start";
			readonly config: Record<string, unknown>;
			readonly state: Record<string, unknown>;
			readonly dryRun: boolean;
	  }
	| { readonly type: "config"; readonly config: Record<string, unknown> }
	| {
			readonly type: "deliverReply";
			readonly conversation: PluginInboundChatEvent["conversation"];
			readonly text: string;
			readonly dryRun: boolean;
	  }
	| {
			readonly type: "deliverAskUser";
			readonly conversation: PluginInboundChatEvent["conversation"];
			readonly question: string;
			readonly options: readonly string[];
			readonly dryRun: boolean;
	  }
	| {
			readonly type: "statusUpdate";
			readonly conversation: PluginInboundChatEvent["conversation"];
			readonly line: string;
	  }
	| {
			readonly type: "statusClear";
			readonly conversation: PluginInboundChatEvent["conversation"];
	  }
	| {
			readonly type: "getPersonaAppendix";
			readonly requestId: string;
			readonly conversation: PluginInboundChatEvent["conversation"];
	  }
	| { readonly type: "shutdown" };

export interface PluginStatusResponse {
	readonly ok: boolean;
	readonly name?: string;
	readonly displayName?: string;
	readonly description?: string;
	readonly version?: string;
	readonly protocolVersion?: string;
	readonly connected?: boolean;
	readonly capabilities?: readonly IntegrationCapability[];
	readonly providerCategories?: readonly ProviderCategory[];
	readonly resources?: readonly string[];
	readonly authMethods?: readonly PluginAuthMethodDescriptor[];
	readonly chatModelPrep?: PluginChatModelPrep;
	readonly chatReadiness?: PluginChatReadiness;
	readonly inboundPrep?: PluginInboundPrep;
	readonly tools?: readonly PluginToolHealth[];
	readonly details?: string;
	readonly setupAvailable?: boolean;
	readonly setupDescription?: string;
	readonly error?: string;
	readonly code?: string;
}

export interface PluginSetupActionResult {
	readonly id: string;
	readonly label: string;
	readonly ok: boolean;
	readonly skipped?: boolean;
	readonly detail?: string;
}

export interface PluginSetupResponse {
	readonly ok: boolean;
	readonly reason?: string;
	readonly config?: Record<string, unknown>;
	readonly actions?: readonly PluginSetupActionResult[];
	readonly error?: string;
	readonly code?: string;
}

export interface PluginSetupGuideLink {
	readonly label: string;
	readonly url: string;
}

export interface PluginSetupGuideArtifact {
	readonly id: string;
	readonly label: string;
	readonly value: string;
	readonly hint?: string;
}

export interface PluginSetupGuideStep {
	readonly id: string;
	readonly title: string;
	readonly description?: string;
	readonly links?: readonly PluginSetupGuideLink[];
	readonly artifacts?: readonly PluginSetupGuideArtifact[];
}

export interface PluginSetupGuideResponse {
	readonly ok: boolean;
	readonly name?: string;
	readonly displayName?: string;
	readonly description?: string;
	readonly steps?: readonly PluginSetupGuideStep[];
	readonly error?: string;
	readonly code?: string;
}

export interface PluginActionResponse {
	readonly ok: boolean;
	readonly reason?: string;
	readonly config?: Record<string, unknown>;
	readonly details?: Record<string, unknown>;
	readonly error?: string;
	readonly code?: string;
}

export interface PluginConfigShapeResponse {
	readonly ok: boolean;
	readonly fields?: readonly PluginConfigField[];
	readonly error?: string;
	readonly code?: string;
}

export interface PluginConfigGetResponse {
	readonly ok: boolean;
	readonly config?: Record<string, unknown>;
	readonly error?: string;
	readonly code?: string;
}

export interface PluginToolsListResponse {
	readonly ok: boolean;
	readonly tools?: readonly PluginToolDefinition[];
	readonly error?: string;
	readonly code?: string;
}

export interface PluginToolExecuteRequest extends PluginConfigEnvelope {
	readonly tool: string;
	readonly input: Record<string, unknown>;
	readonly dryRun?: boolean;
}

export interface PluginToolExecuteResponse {
	readonly ok: boolean;
	readonly result?: unknown;
	readonly appliedActions?: readonly string[];
	readonly config?: Record<string, unknown>;
	readonly error?: string;
	readonly code?: string;
}

/** Response from the `events poll` subcommand. */
export interface PluginEventsPollResponse {
	readonly ok: boolean;
	/** Human-readable summary of what was synced. */
	readonly summary?: string;
	/** Number of new items fetched since the last poll (e.g. new messages). */
	readonly newCount?: number;
	/** Arbitrary sync metadata (e.g. last UID, cursor position). */
	readonly details?: Record<string, unknown>;
	readonly error?: string;
	readonly code?: string;
}

/**
 * A discovered plugin. `binaryName` is always `toby-plugin-<name>` and is
 * common to both kinds so callers that only need the name don't need to
 * narrow on `kind`.
 */
export type DiscoveredPlugin =
	| {
			readonly kind: "binary";
			readonly binaryName: string;
			readonly binaryPath: string;
	  }
	| {
			readonly kind: "bun-package";
			readonly binaryName: string;
			readonly directoryPath: string;
			readonly manifestPath: string;
			readonly entryPath: string;
	  };

/**
 * Invocation target for the plugin client. Binary plugins are spawned
 * directly; bun-package plugins are executed via `bun run <entry>` with
 * `cwd` set to the plugin directory.
 */
export type PluginInvocationTarget =
	| { readonly kind: "binary"; readonly executablePath: string }
	| {
			readonly kind: "bun-package";
			readonly bunPath: string;
			readonly cwd: string;
			readonly entryPath: string;
	  };

/** Polling configuration for a plugin event. */
export interface PluginManifestPollConfig {
	/** Poll interval in seconds. The daemon calls `events poll` at this cadence. */
	readonly intervalSeconds: number;
}

/** Declared plugin events that the daemon should drive. */
export interface PluginManifestEvents {
	readonly poll?: PluginManifestPollConfig;
}

/** Manifest for a bun-package (TypeScript directory) plugin. */
export interface PluginManifest {
	readonly name: string;
	readonly displayName: string;
	readonly description: string;
	readonly version: string;
	readonly protocolVersion: string;
	readonly runtime: { readonly type: "bun"; readonly entry: string };
	readonly capabilities?: readonly IntegrationCapability[];
	readonly providerCategories?: readonly ProviderCategory[];
	readonly events?: PluginManifestEvents;
}

export function parsePluginNameFromBinary(binaryName: string): string | null {
	if (!binaryName.startsWith(PLUGIN_BINARY_PREFIX)) {
		return null;
	}
	const name = binaryName.slice(PLUGIN_BINARY_PREFIX.length);
	if (!/^[a-z0-9_-]+$/.test(name)) {
		return null;
	}
	return name;
}

export function isSupportedProtocolVersion(version: string): boolean {
	return (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(version);
}

/** Display path for a discovered plugin (binary path or directory path). */
export function pluginDisplayPath(d: DiscoveredPlugin): string {
	return d.kind === "binary" ? d.binaryPath : d.directoryPath;
}

/** Display path for an invocation target (executable or plugin directory). */
export function targetDisplayPath(t: PluginInvocationTarget): string {
	return t.kind === "binary" ? t.executablePath : t.cwd;
}
