#!/usr/bin/env bun
/**
 * News installable Toby plugin (protocol v1, bun-package).
 *
 * Fetches latest headlines and searches recent articles through
 * The Guardian Open Platform (free personal API key).
 */

import {
	NEWS_SECTION_OPTIONS,
	hasNewsApiKey,
	normalizeConfig,
	testNewsConnection,
} from "./client";
import { buildChatModelPrep, buildChatReadiness } from "./prompts";
import { emitError, emitJson, parseEnvelope, readStdin } from "./protocol";
import { TOOL_DEFINITIONS, ToolFailure, executeTool } from "./tools";

type JsonRecord = Record<string, unknown>;

const PLUGIN_VERSION = "1.0.0";
const PROTOCOL_VERSION = "1";
const DISPLAY_NAME = "News";
const DESCRIPTION =
	"Get the latest headlines and search recent news via The Guardian's free Open Platform API";
const RESOURCES = ["news", "headlines"];

function isConnected(config: JsonRecord, state: JsonRecord): boolean {
	return Boolean(state.connectedAt) || hasNewsApiKey(config);
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function validateNewsTools(
	config: JsonRecord,
): Promise<Array<{ tool: string; ok: boolean; details: string }>> {
	const checks: Array<{ tool: string; ok: boolean; details: string }> = [];
	try {
		await testNewsConnection(config);
		checks.push({
			tool: "getLatestNews",
			ok: true,
			details: "Fetched latest headlines successfully.",
		});
		checks.push({
			tool: "searchNews",
			ok: true,
			details: "Search uses the same Guardian API as getLatestNews.",
		});
	} catch (error) {
		const details = toErrorMessage(error);
		checks.push({ tool: "getLatestNews", ok: false, details });
		checks.push({
			tool: "searchNews",
			ok: false,
			details: "Not executed because the Guardian API check failed.",
		});
	}
	return checks;
}

async function handleStatus(
	config: JsonRecord,
	state: JsonRecord,
	validateTools: boolean,
): Promise<never> {
	const connected = isConnected(config, state);
	const payload: JsonRecord = {
		ok: true,
		name: "news",
		displayName: DISPLAY_NAME,
		description: DESCRIPTION,
		version: PLUGIN_VERSION,
		protocolVersion: PROTOCOL_VERSION,
		icon: "📰",
		launchUrl: "https://www.theguardian.com",
		connected,
		capabilities: ["chat"],
		resources: RESOURCES,
		chatModelPrep: buildChatModelPrep(),
		chatReadiness: buildChatReadiness(config, state),
		details: connected
			? "Guardian news API reachable."
			: "News is not connected. Add a free Guardian API key, then run `toby connect news`.",
	};

	if (hasNewsApiKey(config)) {
		try {
			await testNewsConnection(config);
			payload.details = state.connectedAt
				? "Guardian news API reachable."
				: "Guardian API key configured. Run `toby connect news` to mark connected, or use chat directly.";
		} catch (error) {
			payload.ok = false;
			payload.details = `Guardian API check failed: ${toErrorMessage(error)}`;
		}
	}

	if (validateTools && hasNewsApiKey(config)) {
		const toolChecks = await validateNewsTools(config);
		payload.tools = toolChecks;
		const failed = toolChecks.filter((check) => check.ok !== true);
		if (failed.length === 0) {
			payload.ok = true;
			payload.details = `Guardian API reachable; validated ${toolChecks.length} tool check(s).`;
		} else {
			payload.ok = false;
			payload.details = `Connected, but ${failed.length}/${toolChecks.length} tool check(s) failed.`;
		}
	}

	emitJson(payload);
}

async function handleConnect(config: JsonRecord): Promise<never> {
	if (!hasNewsApiKey(config)) {
		emitJson({
			ok: false,
			reason:
				"A Guardian Open Platform API key is required. Get a free key at https://open-platform.theguardian.com/access/ and add it in Toby configure.",
		});
	}

	try {
		await testNewsConnection(config);
		emitJson({ ok: true, reason: "News connected successfully." });
	} catch (error) {
		emitJson({
			ok: false,
			reason: `Could not reach The Guardian API: ${toErrorMessage(error)}`,
		});
	}
}

function handleDisconnect(): never {
	emitJson({ ok: true, reason: "News disconnected." });
}

function handleConfigShape(): never {
	emitJson({
		ok: true,
		fields: [
			{
				key: "apiKey",
				label: "Guardian API key",
				type: "string",
				required: true,
				masked: true,
				description:
					"Free key from https://open-platform.theguardian.com/access/",
			},
			{
				key: "defaultSection",
				label: "Default section",
				type: "select",
				required: false,
				default: "all",
				options: [...NEWS_SECTION_OPTIONS],
				description:
					"Used when a tool call does not specify a section. Choose all for every Guardian desk.",
			},
		],
	});
}

function handleConfigGet(config: JsonRecord): never {
	emitJson({ ok: true, config: normalizeConfig(config) });
}

function handleConfigSet(): never {
	emitJson({ ok: true, reason: "News config synced." });
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

	if (!TOOL_DEFINITIONS.some((definition) => definition.name === tool)) {
		emitJson({ ok: false, error: `Unknown tool: ${tool}` });
	}

	try {
		const { result, appliedActions } = await executeTool(
			tool,
			input,
			config,
			Boolean(body.dryRun),
		);
		const response: JsonRecord = { ok: true, result };
		if (appliedActions.length > 0) {
			response.appliedActions = appliedActions;
		}
		emitJson(response);
	} catch (error) {
		if (error instanceof ToolFailure) {
			emitJson({ ok: false, error: error.message });
		}
		emitJson({
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

function handleSetupGuide(): never {
	emitJson({
		ok: true,
		name: "news",
		displayName: DISPLAY_NAME,
		description: DESCRIPTION,
		steps: [
			{
				id: "overview",
				title: "What News can do in Toby",
				description:
					"Connect Toby to The Guardian Open Platform so chat can fetch latest headlines and search recent articles. The developer tier is free for personal use.",
			},
			{
				id: "provider",
				title: "Get a free Guardian API key",
				description:
					"Register on The Guardian Open Platform and copy your API key. Registration is free and does not require a credit card.",
				links: [
					{
						label: "Get a free API key",
						url: "https://open-platform.theguardian.com/access/",
					},
					{
						label: "API documentation",
						url: "https://open-platform.theguardian.com/documentation/",
					},
				],
			},
			{
				id: "credentials",
				title: "Add the API key",
				description:
					"Paste the Guardian API key into the field below. Optionally pick a default section (world, technology, and so on) for headline requests that do not specify one.",
			},
			{
				id: "auth",
				title: "Connect",
				description:
					"Click Connect. Toby will call The Guardian search API with your key and mark News as connected.",
			},
			{
				id: "validate",
				title: "Validate",
				description:
					"Toby will run a health check to confirm the API key can fetch headlines.",
			},
		],
	});
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
		try {
			const body = JSON.parse(stdin) as JsonRecord;
			await handleToolsExecute(body);
		} catch (error) {
			if (error instanceof SyntaxError) {
				emitError("Invalid JSON on stdin", "invalid_input", 2);
			}
			throw error;
		}
	}

	if (command === "setup" && subcommand === "guide") {
		handleSetupGuide();
	}

	emitError(`Unknown command: ${command ?? "(none)"}`, "usage", 2);
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	emitError(message, "internal_error", 2);
});
