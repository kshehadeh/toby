import type { Tool } from "ai";
import chalk from "chalk";
import { globalChatToolsPromptSection } from "../../ai/global-chat-tools";
import { runSharedChatTurn } from "../../chat-pipeline/run-turn";
import type { CredentialsFile, Persona } from "../../config/index";
import { composeSystemPromptWithPersona } from "../../personas/prompt";
import type { ConnectionRecord } from "../connection-types";
import { getConnection, getConnectionCredentials } from "../connections";
import type {
	ChatRunOptions,
	CredentialFieldDescriptor,
	IntegrationModule,
	TestConnectionOptions,
} from "../types";
import {
	connectMcpSession,
	disconnectMcpSession,
	getMcpSession,
	listMcpSessionTools,
} from "./manager";

function namespaced(id: string, field: string): string {
	return `${id}.${field}`;
}

export function createMcpIntegrationModule(
	record: ConnectionRecord,
): IntegrationModule {
	const id = record.id;

	const lifecycle = {
		name: id,
		displayName: record.displayName,
		description: mcpDescription(record),
		icon: undefined,

		async connect(): Promise<void> {
			await connectMcpSession(id);
			console.log(chalk.green(`${record.displayName} connected.`));
		},

		async isConnected(): Promise<boolean> {
			if (getMcpSession(id)) return true;
			const current = getConnection(id);
			return Boolean(current?.connectedAt);
		},

		async testConnection(options?: TestConnectionOptions) {
			const session = getMcpSession(id);
			if (!session) {
				return {
					ok: false,
					details: record.connectedAt
						? `${record.displayName} is saved but not currently connected.`
						: `${record.displayName} is not connected.`,
				};
			}
			const tools = listMcpSessionTools(id);
			return {
				ok: true,
				details: `${session.record.displayName} is healthy (${tools.length} tool${tools.length === 1 ? "" : "s"}).`,
				tools: options?.validateTools
					? tools.map((tool) => ({
							tool: tool.name,
							ok: true,
							details: tool.description,
						}))
					: undefined,
			};
		},

		async disconnect(): Promise<void> {
			await disconnectMcpSession(id);
			console.log(chalk.green(`${record.displayName} disconnected.`));
		},
	};

	async function createChatTools(_params: {
		readonly dryRun: boolean;
		readonly maxResults?: number;
	}): Promise<{ tools: Record<string, Tool>; appliedActions: string[] }> {
		const session = getMcpSession(id);
		if (!session) {
			const current = getConnection(id);
			if (!current?.connectedAt) {
				return { tools: {}, appliedActions: [] };
			}
			try {
				const live = await connectMcpSession(id);
				return { tools: live.tools, appliedActions: [] };
			} catch {
				return { tools: {}, appliedActions: [] };
			}
		}
		return { tools: session.tools, appliedActions: [] };
	}

	async function chat(options: ChatRunOptions): Promise<void> {
		const persona = options.personaForModel;
		console.log(
			chalk.cyan(`${record.displayName} chat (persona "${persona.name}")...`),
		);
		const prep = chatModelPrep;
		const messages = await prep.buildSingleSessionMessages(
			persona,
			options.prompt,
		);
		const result = await runSharedChatTurn(
			[createMcpIntegrationModule(getConnection(id) ?? record)],
			messages,
			{ persona, dryRun: options.dryRun },
		);
		for (const line of result.appliedActions) {
			console.log(chalk.green(`+ ${line}`));
		}
		if (result.text?.trim()) {
			console.log();
			console.log(chalk.bold("Result"));
			console.log(result.text.trim());
		}
	}

	const chatModelPrep = {
		systemPromptSection: mcpSystemPrompt(record),
		async buildSingleSessionMessages(persona: Persona, userPrompt: string) {
			const base = `${mcpSystemPrompt(record)}\n${globalChatToolsPromptSection(undefined, persona)}`;
			const systemContent = composeSystemPromptWithPersona(base, persona);
			const trimmed = userPrompt.trim();
			return [
				{ role: "system" as const, content: systemContent },
				{
					role: "user" as const,
					content: trimmed || "Follow the system instruction.",
				},
			];
		},
		async buildMultiUserContent(userPrompt: string) {
			const trimmed = userPrompt.trim();
			return `MCP server "${record.displayName}": ${trimmed || "follow the system instruction."}`;
		},
	};

	return {
		...lifecycle,
		capabilities: ["chat"],
		authMethods: [
			{ id: "none", label: "None", isDefault: true },
			{ id: "env", label: "Environment variables" },
			{ id: "headers", label: "HTTP headers / bearer token" },
			{ id: "oauth", label: "OAuth 2.1" },
		],
		getCredentialDescriptors: () => credentialDescriptors(id, record),
		seedCredentialValues: (creds: CredentialsFile) => {
			const block = creds.connections?.[id] ?? {};
			const out: Record<string, string> = {};
			for (const [key, value] of Object.entries(block)) {
				if (value) out[namespaced(id, key)] = value;
			}
			return out;
		},
		mergeCredentialsPatch: (values, previous) => {
			const previousBlock = previous.connections?.[id] ?? {};
			const nextBlock = { ...previousBlock };
			const prefix = `${id}.`;
			for (const [key, value] of Object.entries(values)) {
				if (!key.startsWith(prefix)) continue;
				nextBlock[key.slice(prefix.length)] = value;
			}
			return {
				connections: {
					[id]: nextBlock,
				},
			};
		},
		createChatTools,
		chat,
		chatReadiness: async () => {
			if (await lifecycle.isConnected()) return { ok: true };
			return {
				ok: false,
				hint: `Connect the MCP server "${record.displayName}" in Settings → Integrations.`,
			};
		},
		chatModelPrep,
	};
}

function mcpDescription(record: ConnectionRecord): string {
	const transport = record.transport ?? "stdio";
	if (transport === "stdio") {
		return `MCP stdio: ${record.command ?? "(no command)"}`;
	}
	return `MCP ${transport}: ${record.url ?? "(no URL)"}`;
}

function mcpSystemPrompt(record: ConnectionRecord): string {
	const transport = record.transport ?? "stdio";
	const target =
		transport === "stdio" ? (record.command ?? "local process") : record.url;
	return [
		`MCP server "${record.displayName}" (${record.id}) is connected over ${transport} (${target}).`,
		"Use its tools when they are relevant. Tool names are prefixed with the connection id.",
	].join(" ");
}

function credentialDescriptors(
	id: string,
	_record: ConnectionRecord,
): CredentialFieldDescriptor[] {
	return [
		{
			key: namespaced(id, "envJson"),
			label: "Environment variables (JSON object)",
			masked: true,
			multiline: true,
			showForAuthMethods: ["env"],
			group: "Authentication",
		},
		{
			key: namespaced(id, "headersJson"),
			label: "HTTP headers (JSON object)",
			masked: true,
			multiline: true,
			showForAuthMethods: ["headers"],
			group: "Authentication",
		},
		{
			key: namespaced(id, "bearerToken"),
			label: "Bearer token",
			masked: true,
			showForAuthMethods: ["headers"],
			group: "Authentication",
		},
	];
}
