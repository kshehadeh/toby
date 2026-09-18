import type { Tool } from "ai";
import { clearSessionToolBundleCache } from "../../chat-pipeline/tool-bundle-cache";
import { daemonLog } from "../../logging/daemon-log";
import type { ConnectionRecord } from "../connection-types";
import {
	getConnection,
	listMcpConnections,
	mcpPrefixedToolName,
	upsertConnection,
} from "../connections";
import { type McpClientHandle, createMcpClientForRecord } from "./client";

export type McpLiveSession = {
	readonly record: ConnectionRecord;
	readonly handle: McpClientHandle;
	readonly tools: Record<string, Tool>;
};

const sessions = new Map<string, McpLiveSession>();

function listedTools(
	record: ConnectionRecord,
	handle: McpClientHandle,
): Record<string, Tool> {
	const allow = new Set(record.toolAllowlist ?? []);
	const out: Record<string, Tool> = {};
	for (const [original, tool] of Object.entries(handle.tools)) {
		if (allow.size > 0 && !allow.has(original)) continue;
		out[mcpPrefixedToolName(record.id, original)] = tool;
	}
	return out;
}

export function getMcpSession(id: string): McpLiveSession | undefined {
	return sessions.get(id);
}

export function listMcpSessions(): McpLiveSession[] {
	return [...sessions.values()];
}

export function listMcpSessionTools(
	id: string,
): Array<{ name: string; originalName: string; description: string }> {
	const session = sessions.get(id);
	if (!session) return [];
	const reverse = new Map<string, string>();
	for (const [original, prefixed] of Object.entries(
		Object.fromEntries(
			Object.keys(session.handle.tools).map((original) => [
				original,
				mcpPrefixedToolName(session.record.id, original),
			]),
		),
	)) {
		reverse.set(prefixed, original);
	}
	return Object.entries(session.tools).map(([name, tool]) => ({
		name,
		originalName: reverse.get(name) ?? name,
		description: typeof tool.description === "string" ? tool.description : name,
	}));
}

export async function connectMcpSession(id: string): Promise<McpLiveSession> {
	const existing = sessions.get(id);
	if (existing) {
		return existing;
	}
	const record = getConnection(id);
	if (!record || record.type !== "mcp") {
		throw new Error(`Unknown MCP connection: ${id}`);
	}
	validateMcpRecord(record);
	const handle = await createMcpClientForRecord(record);
	if (!getConnection(id)) {
		try {
			await handle.close();
		} catch {
			// Connection was removed while OAuth/connect was in flight.
		}
		throw new Error("MCP connection was removed during connect.");
	}
	const connected: ConnectionRecord = {
		...record,
		connectedAt: record.connectedAt ?? new Date().toISOString(),
	};
	upsertConnection(id, connected);
	const session: McpLiveSession = {
		record: connected,
		handle,
		tools: listedTools(connected, handle),
	};
	sessions.set(id, session);
	clearSessionToolBundleCache();
	daemonLog("info", "plugin", "mcp_connected", {
		connectionId: id,
		transport: record.transport,
		toolCount: Object.keys(session.tools).length,
	});
	return session;
}

export async function disconnectMcpSession(
	id: string,
	options: { readonly clearConnectedAt?: boolean } = {},
): Promise<void> {
	const session = sessions.get(id);
	if (session) {
		try {
			await session.handle.close();
		} catch (error) {
			daemonLog("warn", "plugin", "mcp_close_failed", {
				connectionId: id,
				message: error instanceof Error ? error.message : String(error),
			});
		}
		sessions.delete(id);
	}
	const record = getConnection(id);
	if (record && options.clearConnectedAt !== false) {
		upsertConnection(id, {
			type: record.type,
			displayName: record.displayName,
			transport: record.transport,
			command: record.command,
			args: record.args,
			cwd: record.cwd,
			url: record.url,
			authMethod: record.authMethod,
			toolAllowlist: record.toolAllowlist,
			connectedAt: undefined,
			mcpSessionId: undefined,
		});
	}
	clearSessionToolBundleCache();
	daemonLog("info", "plugin", "mcp_disconnected", { connectionId: id });
}

export async function reconnectConnectedMcpServers(): Promise<void> {
	for (const record of listMcpConnections()) {
		if (!record.connectedAt) continue;
		try {
			await connectMcpSession(record.id);
		} catch (error) {
			daemonLog("warn", "plugin", "mcp_reconnect_failed", {
				connectionId: record.id,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

export async function closeAllMcpSessions(): Promise<void> {
	const ids = [...sessions.keys()];
	for (const id of ids) {
		await disconnectMcpSession(id, { clearConnectedAt: false });
	}
}

export function validateMcpRecord(record: ConnectionRecord): void {
	const transport = record.transport ?? "stdio";
	if (transport === "stdio") {
		if (!record.command?.trim()) {
			throw new Error("MCP stdio connections require a command.");
		}
		if (record.authMethod === "oauth") {
			throw new Error("MCP stdio connections cannot use OAuth.");
		}
		return;
	}
	if (transport !== "http" && transport !== "sse") {
		throw new Error(`Unsupported MCP transport: ${transport}`);
	}
	if (!record.url?.trim()) {
		throw new Error("MCP HTTP/SSE connections require a URL.");
	}
	try {
		const parsed = new URL(record.url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw new Error("MCP URL must be http or https.");
		}
	} catch (error) {
		throw new Error(
			error instanceof Error ? error.message : "Invalid MCP URL.",
		);
	}
}
