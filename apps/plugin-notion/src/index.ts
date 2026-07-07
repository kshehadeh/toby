#!/usr/bin/env bun
/**
 * Notion installable Toby plugin (protocol v1, bun-package).
 */

import {
	hasNotionApiKey,
	normalizeConfig,
	testNotionConnection,
} from "./client";
import { buildChatModelPrep } from "./prompts";
import { emitError, emitJson, parseEnvelope, readStdin } from "./protocol";
import { TOOL_DEFINITIONS, executeTool } from "./tools";

type JsonRecord = Record<string, unknown>;

const PLUGIN_VERSION = "1.0.0";
const PROTOCOL_VERSION = "1";
const DISPLAY_NAME = "Notion";
const DESCRIPTION = "Store and retrieve contextual documents in Notion";

function isConnected(config: JsonRecord, state: JsonRecord): boolean {
	return Boolean(state.connectedAt) || hasNotionApiKey(config);
}

function buildChatReadiness(
	config: JsonRecord,
	state: JsonRecord,
): { ok: boolean; hint?: string } {
	if (state.connectedAt || hasNotionApiKey(config)) {
		return { ok: true };
	}
	return {
		ok: false,
		hint: "Add a Notion personal access token or internal connection token in `toby configure`, then run `toby connect notion`.",
	};
}

function validateNotionTools(): Array<{
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
		name: "notion",
		displayName: DISPLAY_NAME,
		description: DESCRIPTION,
		version: PLUGIN_VERSION,
		protocolVersion: PROTOCOL_VERSION,
		icon: "📝",
		connected,
		capabilities: ["chat"],
		providerCategories: ["documents"],
		resources: ["pages", "databases", "blocks"],
		chatModelPrep: buildChatModelPrep(),
		chatReadiness: buildChatReadiness(config, state),
		details: connected
			? "Notion connected."
			: "Notion is not connected. Add a token in `toby configure`.",
	};

	if (state.connectedAt) {
		try {
			await testNotionConnection(config);
			payload.details = "Notion API reachable.";
		} catch (error) {
			payload.ok = false;
			payload.details = `Connected, but Notion API check failed: ${toErrorMessage(error)}`;
		}
	}

	if (validateTools) {
		payload.tools = validateNotionTools();
	}

	emitJson(payload);
}

async function handleConnect(config: JsonRecord): Promise<never> {
	if (!hasNotionApiKey(config)) {
		emitJson({
			ok: false,
			reason:
				"Notion requires an API key. Add a Notion personal access token or internal connection token in `toby configure`.",
		});
	}

	try {
		await testNotionConnection(config);
		emitJson({
			ok: true,
			reason: "Notion connected successfully.",
			config: normalizeConfig(config),
		});
	} catch (error) {
		emitJson({
			ok: false,
			reason: `Notion token is invalid or missing permissions: ${toErrorMessage(error)}`,
		});
	}
}

function handleDisconnect(): never {
	emitJson({
		ok: true,
		reason: "Notion disconnected.",
		config: {
			apiKey: "",
			defaultParentPageId: "",
		},
	});
}

function handleConfigShape(): never {
	emitJson({
		ok: true,
		fields: [
			{
				key: "apiKey",
				label: "Notion API Key",
				type: "string",
				required: true,
				masked: true,
				description:
					"Personal access token or internal connection token from Notion.",
			},
			{
				key: "defaultParentPageId",
				label: "Default Parent Page ID",
				type: "string",
				required: false,
				description:
					"Optional Notion page id used when creating pages without an explicit parentPageId.",
			},
		],
	});
}

function handleConfigGet(config: JsonRecord): never {
	emitJson({
		ok: true,
		config: {
			...normalizeConfig(config),
			apiKey: "",
		},
	});
}

function handleConfigSet(): never {
	emitJson({ ok: true, reason: "Notion config synced." });
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
