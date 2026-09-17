import { invalidateSettingsCache } from "../../configure/settings-cache";
import type {
	McpAuthMethod,
	McpTransportKind,
} from "../../integrations/connection-types";
import {
	MCP_CONNECTION_TYPE,
	allocateMcpConnectionId,
	deleteConnection,
	getConnection,
	listConnections,
	upsertConnection,
} from "../../integrations/connections";
import { writeConnectionCredentials } from "../../integrations/connections";
import { getIntegrationModule } from "../../integrations/index";
import {
	connectMcpSession,
	disconnectMcpSession,
	listMcpSessionTools,
	validateMcpRecord,
} from "../../integrations/mcp/manager";
import { errorResponse, jsonResponse, readJsonBody } from "../http-utils";

function publicConnection(id: string) {
	const record = getConnection(id);
	if (!record) return null;
	const module = getIntegrationModule(id);
	return {
		id: record.id,
		type: record.type,
		displayName: record.displayName,
		connected: Boolean(record.connectedAt),
		connectedAt: record.connectedAt ?? null,
		transport: record.transport ?? null,
		command: record.command ?? null,
		args: record.args ?? [],
		cwd: record.cwd ?? null,
		url: record.url ?? null,
		authMethod: record.authMethod ?? "none",
		toolAllowlist: record.toolAllowlist ?? [],
		tools: record.type === MCP_CONNECTION_TYPE ? listMcpSessionTools(id) : [],
		maxInstances: record.type === MCP_CONNECTION_TYPE ? "unbounded" : 1,
		description: module?.description ?? null,
	};
}

export async function handleConnectionsList(): Promise<Response> {
	const connections = listConnections().map((record) =>
		publicConnection(record.id),
	);
	return jsonResponse({ connections });
}

export async function handleConnectionDetail(id: string): Promise<Response> {
	const body = publicConnection(id);
	if (!body) return errorResponse("Connection not found", 404);
	return jsonResponse(body);
}

export async function handleConnectionCreate(req: Request): Promise<Response> {
	const body = await readJsonBody<Record<string, unknown>>(req);
	if (!body) return errorResponse("Invalid JSON", 400);
	const type = typeof body.type === "string" ? body.type.trim() : "";
	if (type !== MCP_CONNECTION_TYPE) {
		return errorResponse(
			"Only MCP connections can be created via this endpoint. Use plugin connect for singleton integrations.",
			400,
		);
	}
	const displayName =
		typeof body.displayName === "string" && body.displayName.trim()
			? body.displayName.trim()
			: "MCP server";
	const transport = parseTransport(body.transport);
	const authMethod = parseAuthMethod(body.authMethod);
	const command = optionalString(body.command);
	const cwd = optionalString(body.cwd);
	const url = optionalString(body.url);
	const args = parseStringArray(body.args);
	const toolAllowlist = parseStringArray(body.toolAllowlist);
	const id =
		typeof body.id === "string" && body.id.startsWith("mcp_")
			? body.id
			: allocateMcpConnectionId(displayName);

	if (getConnection(id)) {
		return errorResponse(`Connection already exists: ${id}`, 409);
	}

	const record = upsertConnection(id, {
		type: MCP_CONNECTION_TYPE,
		displayName,
		transport,
		command,
		args,
		cwd,
		url,
		authMethod,
		toolAllowlist,
	});
	try {
		validateMcpRecord(record);
	} catch (error) {
		deleteConnection(id);
		return errorResponse(
			error instanceof Error ? error.message : String(error),
			400,
		);
	}

	const secrets = parseSecretBag(body);
	if (Object.keys(secrets).length > 0) {
		writeConnectionCredentials(id, secrets, { dualWriteIntegrations: false });
	}

	const connectNow = body.connect !== false;
	if (connectNow) {
		try {
			await connectMcpSession(id);
		} catch (error) {
			return errorResponse(
				error instanceof Error ? error.message : String(error),
				500,
			);
		}
	}

	invalidateSettingsCache();
	return jsonResponse({ ok: true, connection: publicConnection(id) }, 201);
}

export async function handleConnectionDelete(id: string): Promise<Response> {
	const record = getConnection(id);
	if (!record) return errorResponse("Connection not found", 404);
	if (record.type === MCP_CONNECTION_TYPE) {
		await disconnectMcpSession(id, { clearConnectedAt: false });
	} else {
		const module = getIntegrationModule(id);
		if (module) await module.disconnect();
	}
	deleteConnection(id);
	invalidateSettingsCache();
	return jsonResponse({ ok: true });
}

export async function handleConnectionConnect(id: string): Promise<Response> {
	const module = getIntegrationModule(id);
	if (!module) return errorResponse("Connection not found", 404);
	try {
		await module.connect();
		invalidateSettingsCache();
		return jsonResponse({ ok: true, connection: publicConnection(id) });
	} catch (error) {
		return errorResponse(
			error instanceof Error ? error.message : String(error),
			500,
		);
	}
}

export async function handleConnectionDisconnect(
	id: string,
): Promise<Response> {
	const module = getIntegrationModule(id);
	if (!module) return errorResponse("Connection not found", 404);
	try {
		await module.disconnect();
		invalidateSettingsCache();
		return jsonResponse({ ok: true, connection: publicConnection(id) });
	} catch (error) {
		return errorResponse(
			error instanceof Error ? error.message : String(error),
			500,
		);
	}
}

function parseTransport(value: unknown): McpTransportKind {
	if (value === "http" || value === "sse" || value === "stdio") return value;
	return "stdio";
}

function parseAuthMethod(value: unknown): McpAuthMethod {
	if (
		value === "env" ||
		value === "headers" ||
		value === "oauth" ||
		value === "none"
	) {
		return value;
	}
	return "none";
}

function optionalString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

function parseStringArray(value: unknown): string[] | undefined {
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === "string");
	}
	if (typeof value === "string" && value.trim()) {
		try {
			const parsed = JSON.parse(value) as unknown;
			if (Array.isArray(parsed)) {
				return parsed.filter(
					(item): item is string => typeof item === "string",
				);
			}
		} catch {
			return value
				.split(/\s+/)
				.map((item) => item.trim())
				.filter(Boolean);
		}
	}
	return undefined;
}

function parseSecretBag(body: Record<string, unknown>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const key of [
		"envJson",
		"headersJson",
		"bearerToken",
		"oauthClientId",
		"oauthClientSecret",
	]) {
		const value = body[key];
		if (typeof value === "string" && value.trim()) {
			out[key] = value;
		}
	}
	if (body.env && typeof body.env === "object" && !Array.isArray(body.env)) {
		out.envJson = JSON.stringify(body.env);
	}
	if (
		body.headers &&
		typeof body.headers === "object" &&
		!Array.isArray(body.headers)
	) {
		out.headersJson = JSON.stringify(body.headers);
	}
	return out;
}
