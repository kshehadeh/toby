import type { IntegrationCapability, ProviderCategory } from "../types";

/** Supported plugin protocol versions (newest first). */
export const SUPPORTED_PROTOCOL_VERSIONS = ["1"] as const;
export const CURRENT_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export const PLUGIN_BINARY_PREFIX = "toby-plugin-";

export type PluginConfigEnvelope = {
	readonly config?: Record<string, unknown>;
	readonly state?: Record<string, unknown>;
	readonly validateTools?: boolean;
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
	readonly tools?: readonly PluginToolHealth[];
	readonly details?: string;
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

export interface DiscoveredPlugin {
	readonly binaryPath: string;
	readonly binaryName: string;
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
