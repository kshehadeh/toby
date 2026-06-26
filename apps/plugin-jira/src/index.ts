#!/usr/bin/env bun
/**
 * Jira installable Toby plugin (protocol v1, bun-package).
 */

import { hasCredentials, testConnection } from "./client";
import { buildChatModelPrep } from "./prompts";
import { emitError, emitJson, parseEnvelope, readStdin } from "./protocol";
import { TOOL_DEFINITIONS, executeTool } from "./tools";

type JsonRecord = Record<string, unknown>;

const PLUGIN_VERSION = "1.0.0";
const PROTOCOL_VERSION = "1";
const DISPLAY_NAME = "Jira";
const DESCRIPTION = "Atlassian Jira issue tracking";

function isConnected(config: JsonRecord, state: JsonRecord): boolean {
	return Boolean(state.connectedAt) || hasCredentials(config);
}

function buildChatReadiness(
	config: JsonRecord,
	state: JsonRecord,
): { ok: boolean; hint?: string } {
	if (state.connectedAt || hasCredentials(config)) {
		return { ok: true };
	}
	return {
		ok: false,
		hint: "Add Jira credentials (domain, email, API token) in `toby configure` or run `toby connect jira`.",
	};
}

function validateJiraTools(): Array<{
	tool: string;
	ok: boolean;
	details: string;
}> {
	return TOOL_DEFINITIONS.map((definition) => ({
		tool: definition.name,
		ok: true,
		details: "Tool is available.",
	}));
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function handleStatus(
	config: JsonRecord,
	state: JsonRecord,
	validateTools: boolean,
): Promise<never> {
	const connected = isConnected(config, state);
	const payload: JsonRecord = {
		ok: true,
		name: "jira",
		displayName: DISPLAY_NAME,
		description: DESCRIPTION,
		version: PLUGIN_VERSION,
		protocolVersion: PROTOCOL_VERSION,
		connected,
		capabilities: ["chat"],
		providerCategories: ["work_tracker"],
		resources: ["issues", "projects"],
		chatModelPrep: buildChatModelPrep(),
		chatReadiness: buildChatReadiness(config, state),
		details: connected
			? "Jira connected."
			: "Jira is not connected. Run `toby connect jira` after configuring credentials.",
	};

	if (connected) {
		try {
			await testConnection(config);
			payload.details = "Jira API reachable.";
		} catch (error) {
			payload.ok = false;
			payload.details = `Connected, but Jira API check failed: ${toErrorMessage(error)}`;
		}
	}

	if (validateTools) {
		payload.tools = validateJiraTools();
	}

	emitJson(payload);
}

async function handleConnect(config: JsonRecord): Promise<never> {
	if (!hasCredentials(config)) {
		emitJson({
			ok: false,
			reason:
				"Jira requires credentials (domain, email, API token). Add them in `toby configure` under Jira.",
		});
	}

	try {
		await testConnection(config);
		emitJson({ ok: true, reason: "Jira connected successfully." });
	} catch (error) {
		emitJson({
			ok: false,
			reason: `Jira credentials are invalid or missing permissions: ${toErrorMessage(error)}`,
		});
	}
}

function handleDisconnect(): never {
	emitJson({ ok: true, reason: "Jira disconnected." });
}

function handleConfigShape(): never {
	emitJson({
		ok: true,
		fields: [
			{
				key: "domain",
				label: "Atlassian Domain",
				type: "string",
				required: true,
				description:
					"Your Atlassian site domain (e.g. 'acme' for acme.atlassian.net)",
			},
			{
				key: "email",
				label: "Email",
				type: "string",
				required: true,
				description: "Atlassian account email",
			},
			{
				key: "apiToken",
				label: "API Token",
				type: "string",
				required: true,
				masked: true,
				description:
					"Atlassian API token (create at https://id.atlassian.com/manage-profile/security/api-tokens)",
			},
		],
	});
}

function handleConfigGet(config: JsonRecord): never {
	emitJson({
		ok: true,
		config: {
			domain: String(config.domain ?? ""),
			email: String(config.email ?? ""),
			apiToken: String(config.apiToken ?? ""),
		},
	});
}

function handleConfigSet(): never {
	emitJson({ ok: true, reason: "Jira config synced." });
}

function handleToolsList(): never {
	emitJson({ ok: true, tools: TOOL_DEFINITIONS });
}

async function handleToolsExecute(body: JsonRecord): Promise<never> {
	const tool = String(body.tool ?? "");
	const input =
		body.input && typeof body.input === "object" && !Array.isArray(body.input)
			? (body.input as JsonRecord)
			: {};
	const config =
		body.config &&
		typeof body.config === "object" &&
		!Array.isArray(body.config)
			? (body.config as JsonRecord)
			: {};
	const dryRun = Boolean(body.dryRun);

	if (!TOOL_DEFINITIONS.some((definition) => definition.name === tool)) {
		emitJson({ ok: false, error: `Unknown tool: ${tool}` });
	}

	try {
		const { result, appliedActions } = await executeTool(
			tool,
			input,
			config,
			dryRun,
		);
		const response: JsonRecord = { ok: true, result };
		if (appliedActions?.length) {
			response.appliedActions = appliedActions;
		}
		emitJson(response);
	} catch (error) {
		emitJson({ ok: false, error: toErrorMessage(error) });
	}
}

async function main(): Promise<void> {
	const [command, subcommand] = process.argv.slice(2);
	const stdin = await readStdin();

	if (command === "status") {
		const { config, state, validateTools } = parseEnvelope(stdin);
		await handleStatus(config, state, validateTools);
	}

	if (command === "connect") {
		const { config } = parseEnvelope(stdin);
		await handleConnect(config);
	}

	if (command === "disconnect") {
		handleDisconnect();
	}

	if (command === "config" && subcommand === "shape") {
		handleConfigShape();
	}

	if (command === "config" && subcommand === "get") {
		const { config } = parseEnvelope(stdin);
		handleConfigGet(config);
	}

	if (command === "config" && subcommand === "set") {
		handleConfigSet();
	}

	if (command === "tools" && subcommand === "list") {
		handleToolsList();
	}

	if (command === "tools" && subcommand === "execute") {
		if (!stdin.trim()) {
			emitError("tools execute requires JSON on stdin", "invalid_input", 2);
		}
		let body: JsonRecord;
		try {
			body = JSON.parse(stdin) as JsonRecord;
		} catch {
			emitError("Invalid JSON on stdin", "invalid_input", 2);
		}
		await handleToolsExecute(body);
	}

	emitError(`Unknown command: ${command ?? "(none)"}`, "usage", 2);
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	emitError(message, "internal_error", 2);
});
