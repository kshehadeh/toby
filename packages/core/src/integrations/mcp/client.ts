import {
	type MCPClient,
	type OAuthClientProvider,
	UnauthorizedError,
	auth,
	createMCPClient,
} from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import type { Tool } from "ai";
import type { ConnectionRecord } from "../connection-types";
import { getConnectionCredentials } from "../connections";
import {
	captureMcpAuthCallback,
	createMcpOAuthProvider,
	parseEnvBag,
	parseHeaderBag,
} from "./oauth";

export type McpClientHandle = {
	readonly connectionId: string;
	readonly tools: Record<string, Tool>;
	readonly originalNames: Record<string, string>;
	readonly instructions?: string;
	close(): Promise<void>;
};

export type McpClientFactory = (
	record: ConnectionRecord,
) => Promise<McpClientHandle>;

let clientFactory: McpClientFactory = defaultMcpClientFactory;

export function setMcpClientFactory(factory: McpClientFactory | null): void {
	clientFactory = factory ?? defaultMcpClientFactory;
}

export function createMcpClientForRecord(
	record: ConnectionRecord,
): Promise<McpClientHandle> {
	return clientFactory(record);
}

function buildHttpHeaders(record: ConnectionRecord): Record<string, string> {
	const creds = getConnectionCredentials(record.id);
	const headers = parseHeaderBag(creds.headersJson);
	const bearer = creds.bearerToken?.trim();
	if (bearer && !headers.Authorization && !headers.authorization) {
		headers.Authorization = bearer.toLowerCase().startsWith("bearer ")
			? bearer
			: `Bearer ${bearer}`;
	}
	return headers;
}

async function defaultMcpClientFactory(
	record: ConnectionRecord,
): Promise<McpClientHandle> {
	const transport = record.transport ?? "stdio";
	if (transport === "stdio") {
		if (!record.command?.trim()) {
			throw new Error("MCP stdio connections require a command.");
		}
		const creds = getConnectionCredentials(record.id);
		const env = parseEnvBag(creds.envJson);
		const stdio = new Experimental_StdioMCPTransport({
			command: record.command,
			args: record.args ?? [],
			cwd: record.cwd,
			env: Object.keys(env).length > 0 ? env : undefined,
			stderr: "pipe",
		});
		const client = await createMCPClient({
			transport: stdio,
			clientName: "toby",
			name: "toby",
		});
		return wrapClient(record.id, client);
	}

	if (!record.url?.trim()) {
		throw new Error("MCP HTTP/SSE connections require a URL.");
	}

	const headers = buildHttpHeaders(record);
	const authProvider =
		record.authMethod === "oauth"
			? createMcpOAuthProvider(record.id, record.url)
			: undefined;

	const transportConfig = {
		type: transport === "sse" ? ("sse" as const) : ("http" as const),
		url: record.url,
		headers: Object.keys(headers).length > 0 ? headers : undefined,
		authProvider,
	};

	try {
		const client = await createMCPClient({
			transport: transportConfig,
			clientName: "toby",
			name: "toby",
		});
		return wrapClient(record.id, client);
	} catch (error) {
		if (!(error instanceof UnauthorizedError) || !authProvider) {
			throw error;
		}
		await completeMcpOAuth(authProvider, record.url);
		const client = await createMCPClient({
			transport: {
				...transportConfig,
				authProvider,
			},
			clientName: "toby",
			name: "toby",
		});
		return wrapClient(record.id, client);
	}
}

async function completeMcpOAuth(
	authProvider: OAuthClientProvider,
	serverUrl: string,
): Promise<void> {
	const callback = captureMcpAuthCallback();
	await auth(authProvider, { serverUrl });
	const { code, state } = await callback;
	await auth(authProvider, {
		serverUrl,
		authorizationCode: code,
		callbackState: state,
	});
}

async function wrapClient(
	connectionId: string,
	client: MCPClient,
): Promise<McpClientHandle> {
	const tools = (await client.tools()) as Record<string, Tool>;
	const originalNames: Record<string, string> = {};
	for (const name of Object.keys(tools)) {
		originalNames[name] = name;
	}
	return {
		connectionId,
		tools,
		originalNames,
		instructions: client.instructions,
		close: () => client.close(),
	};
}
