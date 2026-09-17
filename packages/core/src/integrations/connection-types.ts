import type { IntegrationCapability } from "./types";

/** Built-in connection type for Model Context Protocol servers. */
export const MCP_CONNECTION_TYPE = "mcp";

export type ConnectionMaxInstances = 1 | "unbounded";

export type McpTransportKind = "stdio" | "http" | "sse";

export type McpAuthMethod = "none" | "env" | "headers" | "oauth";

/**
 * Persisted non-secret connection instance. The record's `id` is the object
 * key in `config.connections` and is echoed here when listing.
 */
export interface ConnectionRecord {
	readonly id: string;
	readonly type: string;
	readonly displayName: string;
	readonly connectedAt?: string;
	readonly pluginVersion?: string;
	readonly transport?: McpTransportKind;
	readonly command?: string;
	readonly args?: string[];
	readonly cwd?: string;
	readonly url?: string;
	readonly authMethod?: McpAuthMethod;
	readonly toolAllowlist?: string[];
	/** Streamable HTTP session id when the server issues `MCP-Session-Id`. */
	readonly mcpSessionId?: string;
}

/** On-disk shape (id is the map key, not a field). */
export type ConnectionRecordState = Omit<ConnectionRecord, "id">;

export interface ConnectionTypeDescriptor {
	readonly typeId: string;
	readonly displayName: string;
	readonly description: string;
	readonly maxInstances: ConnectionMaxInstances;
	readonly capabilities: ReadonlyArray<IntegrationCapability>;
}

export function isMcpConnectionType(typeId: string): boolean {
	return typeId === MCP_CONNECTION_TYPE;
}

export function isMcpConnection(record: ConnectionRecord): boolean {
	return record.type === MCP_CONNECTION_TYPE;
}

export function isSingletonConnection(record: ConnectionRecord): boolean {
	return record.id === record.type && record.type !== MCP_CONNECTION_TYPE;
}

/** Secret keys stored under `credentials.connections[id]`. */
export const MCP_SECRET_FIELDS = [
	"envJson",
	"headersJson",
	"bearerToken",
	"oauthAccessToken",
	"oauthRefreshToken",
	"oauthClientId",
	"oauthClientSecret",
	"oauthExpiresAt",
	"oauthTokenEndpoint",
	"oauthAuthorizationEndpoint",
] as const;

export type McpSecretField = (typeof MCP_SECRET_FIELDS)[number];

export const MCP_CONFIG_FIELDS = [
	"displayName",
	"transport",
	"command",
	"args",
	"cwd",
	"url",
	"authMethod",
	"toolAllowlist",
] as const;

export type McpConfigField = (typeof MCP_CONFIG_FIELDS)[number];
