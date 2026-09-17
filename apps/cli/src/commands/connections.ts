import type {
	McpAuthMethod,
	McpTransportKind,
} from "@toby/core/integrations/connection-types";
import {
	allocateMcpConnectionId,
	deleteConnection,
	getConnection,
	listConnections,
	upsertConnection,
	writeConnectionCredentials,
} from "@toby/core/integrations/connections";
import { getIntegration } from "@toby/core/integrations/index";
import {
	connectMcpSession,
	validateMcpRecord,
} from "@toby/core/integrations/mcp/manager";
import chalk from "chalk";
import type { Command } from "commander";

export function registerConnectionsCommand(program: Command): void {
	const connections = program
		.command("connections")
		.description(
			"List and manage first-class connections, including MCP servers",
		);

	connections
		.command("list")
		.description("List all connections")
		.action(async () => {
			const listed = listConnections();
			if (listed.length === 0) {
				console.log(chalk.dim("No connections yet."));
				return;
			}
			for (const conn of listed) {
				const live = await getIntegration(conn.id)?.isConnected();
				const status =
					live || conn.connectedAt
						? chalk.green("connected")
						: chalk.dim("not connected");
				console.log(
					`  ${chalk.bold(conn.displayName)}  ${chalk.dim(conn.id)}  ${status}`,
				);
				if (conn.type === "mcp") {
					const target = conn.transport === "stdio" ? conn.command : conn.url;
					console.log(
						chalk.dim(
							`    mcp/${conn.transport ?? "stdio"}${target ? `  ${target}` : ""}`,
						),
					);
				}
			}
		});

	connections
		.command("add")
		.description("Add an MCP server connection")
		.requiredOption("--name <displayName>", "Display name")
		.option("--transport <kind>", "stdio | http | sse", "stdio")
		.option("--command <command>", "stdio command")
		.option("--args <json>", "stdio args as a JSON array")
		.option("--cwd <path>", "stdio working directory")
		.option("--url <url>", "HTTP or SSE URL")
		.option("--auth <method>", "none | env | headers | oauth", "none")
		.option("--env-json <json>", "stdio environment JSON object")
		.option("--headers-json <json>", "HTTP headers JSON object")
		.option("--bearer <token>", "Bearer token for HTTP/SSE")
		.option("--no-connect", "Save without connecting")
		.action(
			async (options: {
				name: string;
				transport?: string;
				command?: string;
				args?: string;
				cwd?: string;
				url?: string;
				auth?: string;
				envJson?: string;
				headersJson?: string;
				bearer?: string;
				connect?: boolean;
			}) => {
				const transport = parseTransport(options.transport);
				const authMethod = parseAuthMethod(options.auth);
				const id = allocateMcpConnectionId(options.name);
				const args = parseArgs(options.args);
				const record = upsertConnection(id, {
					type: "mcp",
					displayName: options.name,
					transport,
					command: options.command,
					args,
					cwd: options.cwd,
					url: options.url,
					authMethod,
				});
				try {
					validateMcpRecord(record);
				} catch (error) {
					deleteConnection(id);
					console.log(
						chalk.red(error instanceof Error ? error.message : String(error)),
					);
					process.exitCode = 1;
					return;
				}
				const secrets: Record<string, string> = {};
				if (options.envJson) secrets.envJson = options.envJson;
				if (options.headersJson) secrets.headersJson = options.headersJson;
				if (options.bearer) secrets.bearerToken = options.bearer;
				if (Object.keys(secrets).length > 0) {
					writeConnectionCredentials(id, secrets, {
						dualWriteIntegrations: false,
					});
				}
				if (options.connect === false) {
					console.log(
						chalk.green(`Saved MCP connection ${id} (not connected).`),
					);
					return;
				}
				try {
					await connectMcpSession(id);
					console.log(
						chalk.green(`Connected MCP server "${options.name}" (${id}).`),
					);
				} catch (error) {
					console.log(
						chalk.red(error instanceof Error ? error.message : String(error)),
					);
					process.exitCode = 1;
				}
			},
		);

	connections
		.command("remove <id>")
		.description("Remove a connection")
		.action(async (id: string) => {
			const record = getConnection(id);
			if (!record) {
				console.log(chalk.red(`Unknown connection: ${id}`));
				process.exitCode = 1;
				return;
			}
			const integration = getIntegration(id);
			if (integration) {
				await integration.disconnect();
			}
			deleteConnection(id);
			console.log(chalk.green(`Removed connection ${id}.`));
		});
}

function parseTransport(value: string | undefined): McpTransportKind {
	if (value === "http" || value === "sse" || value === "stdio") return value;
	return "stdio";
}

function parseAuthMethod(value: string | undefined): McpAuthMethod {
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

function parseArgs(raw: string | undefined): string[] | undefined {
	if (!raw?.trim()) return undefined;
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (Array.isArray(parsed)) {
			return parsed.filter((item): item is string => typeof item === "string");
		}
	} catch {
		return raw
			.split(/\s+/)
			.map((item) => item.trim())
			.filter(Boolean);
	}
	return undefined;
}
