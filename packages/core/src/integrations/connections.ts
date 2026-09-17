import {
	type CredentialsFile,
	readConfig,
	readCredentials,
	writeConfig,
	writeCredentials,
} from "../config/index";
import {
	type ConnectionRecord,
	type ConnectionRecordState,
	type ConnectionTypeDescriptor,
	MCP_CONNECTION_TYPE,
	isMcpConnection,
	isSingletonConnection,
} from "./connection-types";

export {
	MCP_CONFIG_FIELDS,
	MCP_CONNECTION_TYPE,
	MCP_SECRET_FIELDS,
	isMcpConnection,
	isMcpConnectionType,
	isSingletonConnection,
	type ConnectionMaxInstances,
	type ConnectionRecord,
	type ConnectionRecordState,
	type ConnectionTypeDescriptor,
	type McpAuthMethod,
	type McpConfigField,
	type McpSecretField,
	type McpTransportKind,
} from "./connection-types";

function stateToRecord(
	id: string,
	state: ConnectionRecordState,
): ConnectionRecord {
	return { id, ...state };
}

export function listConnections(): ConnectionRecord[] {
	const config = readConfig();
	return Object.entries(config.connections ?? {})
		.map(([id, state]) => stateToRecord(id, state))
		.sort((a, b) => a.id.localeCompare(b.id));
}

export function getConnection(id: string): ConnectionRecord | undefined {
	const state = readConfig().connections?.[id];
	if (!state) return undefined;
	return stateToRecord(id, state);
}

export function listMcpConnections(): ConnectionRecord[] {
	return listConnections().filter(isMcpConnection);
}

export function upsertConnection(
	id: string,
	patch: Partial<ConnectionRecordState> &
		Pick<ConnectionRecordState, "type" | "displayName">,
): ConnectionRecord {
	const config = readConfig();
	const previous = config.connections?.[id];
	const definedPatch = Object.fromEntries(
		Object.entries(patch).filter(([, value]) => value !== undefined),
	) as Partial<ConnectionRecordState>;
	const nextState: ConnectionRecordState = {
		...previous,
		...definedPatch,
		type: patch.type,
		displayName: patch.displayName,
	};
	if (Object.hasOwn(patch, "connectedAt") && !patch.connectedAt) {
		Reflect.deleteProperty(nextState, "connectedAt");
	}
	if (Object.hasOwn(patch, "mcpSessionId") && !patch.mcpSessionId) {
		Reflect.deleteProperty(nextState, "mcpSessionId");
	}
	config.connections = {
		...(config.connections ?? {}),
		[id]: nextState,
	};
	if (id === nextState.type && nextState.type !== MCP_CONNECTION_TYPE) {
		config.integrations[id] = {
			...(config.integrations[id] ?? {}),
			...(nextState.connectedAt ? { connectedAt: nextState.connectedAt } : {}),
			...(nextState.pluginVersion
				? { pluginVersion: nextState.pluginVersion }
				: {}),
		};
	}
	writeConfig(config);
	return stateToRecord(id, nextState);
}

export function deleteConnection(id: string): void {
	const config = readConfig();
	if (!config.connections?.[id] && !config.integrations[id]) {
		return;
	}
	const nextConnections = { ...(config.connections ?? {}) };
	Reflect.deleteProperty(nextConnections, id);
	config.connections = nextConnections;
	if (config.integrations[id]) {
		const nextIntegrations = { ...config.integrations };
		Reflect.deleteProperty(nextIntegrations, id);
		config.integrations = nextIntegrations;
	}
	writeConfig(config);

	const creds = readCredentials();
	if (creds.connections?.[id] || creds.integrations?.[id]) {
		const nextCredConnections = { ...(creds.connections ?? {}) };
		Reflect.deleteProperty(nextCredConnections, id);
		const nextCredIntegrations = { ...(creds.integrations ?? {}) };
		Reflect.deleteProperty(nextCredIntegrations, id);
		writeCredentials({
			...creds,
			connections: nextCredConnections,
			integrations: nextCredIntegrations,
		});
	}
}

export function getConnectionCredentials(id: string): Record<string, string> {
	const creds = readCredentials();
	const fromConnections = creds.connections?.[id];
	if (fromConnections && Object.keys(fromConnections).length > 0) {
		return { ...fromConnections };
	}
	return { ...(creds.integrations?.[id] ?? {}) };
}

export function writeConnectionCredentials(
	id: string,
	block: Record<string, string>,
	options: { readonly dualWriteIntegrations?: boolean } = {},
): void {
	const creds = readCredentials();
	const dualWrite =
		options.dualWriteIntegrations ?? !id.startsWith(`${MCP_CONNECTION_TYPE}_`);
	writeCredentials({
		...creds,
		connections: {
			...(creds.connections ?? {}),
			[id]: block,
		},
		integrations: dualWrite
			? {
					...(creds.integrations ?? {}),
					[id]: block,
				}
			: creds.integrations,
	});
}

export function syncSingletonConnection(
	name: string,
	options: {
		readonly displayName: string;
		readonly connectedAt?: string;
		readonly pluginVersion?: string;
	},
): void {
	const config = readConfig();
	const previous = config.connections?.[name];
	const nextState: ConnectionRecordState = {
		...previous,
		type: name,
		displayName: options.displayName,
		...(options.connectedAt
			? { connectedAt: options.connectedAt }
			: previous?.connectedAt
				? { connectedAt: previous.connectedAt }
				: {}),
		...(options.pluginVersion
			? { pluginVersion: options.pluginVersion }
			: previous?.pluginVersion
				? { pluginVersion: previous.pluginVersion }
				: {}),
	};
	config.connections = {
		...(config.connections ?? {}),
		[name]: nextState,
	};
	config.integrations[name] = {
		...(config.integrations[name] ?? {}),
		...(nextState.connectedAt ? { connectedAt: nextState.connectedAt } : {}),
		...(nextState.pluginVersion
			? { pluginVersion: nextState.pluginVersion }
			: {}),
	};
	writeConfig(config);
}

export function allocateMcpConnectionId(displayName: string): string {
	const baseSlug = slugifyMcpName(displayName);
	const existing = new Set(Object.keys(readConfig().connections ?? {}));
	if (!existing.has(baseSlug)) return baseSlug;
	for (let i = 2; i < 1000; i++) {
		const candidate = `${baseSlug}_${i}`;
		if (!existing.has(candidate)) return candidate;
	}
	return `${baseSlug}_${Date.now().toString(36)}`;
}

export function slugifyMcpName(displayName: string): string {
	const slug = displayName
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 32);
	return `${MCP_CONNECTION_TYPE}_${slug || "server"}`;
}

export function parseMcpToolPrefix(connectionId: string): string {
	return connectionId.replace(/[^a-zA-Z0-9_]/g, "_");
}

export function mcpPrefixedToolName(
	connectionId: string,
	toolName: string,
): string {
	const safeTool = toolName.replace(/[^a-zA-Z0-9_]/g, "_");
	return `${parseMcpToolPrefix(connectionId)}_${safeTool}`;
}

export function mcpTypeDescriptor(): ConnectionTypeDescriptor {
	return {
		typeId: MCP_CONNECTION_TYPE,
		displayName: "MCP server",
		description:
			"Connect any Model Context Protocol server over stdio, HTTP, or SSE.",
		maxInstances: "unbounded",
		capabilities: ["chat"],
	};
}
