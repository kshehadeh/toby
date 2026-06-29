#!/usr/bin/env bun
/**
 * Todoist installable Toby plugin (protocol v1).
 * Build: bun run build (from this directory) or `bun run build:plugin:todoist` from repo root.
 */

import {
	fetchCompletedTasks,
	fetchOpenTasks,
	fetchProjects,
	hasTodoistApiKey,
	normalizeConfig,
	testTodoistConnection,
} from "./client";
import {
	TODOIST_MULTI_USER_CONTENT_TEMPLATE,
	TODOIST_SINGLE_SESSION_RULES,
	TODOIST_SINGLE_SESSION_USER_TEMPLATE,
	TODOIST_SYSTEM_PROMPT_SECTION,
} from "./prompts";
import { emitError, emitJson, parseEnvelope, readStdin } from "./protocol";
import { TOOL_DEFINITIONS, executeTool } from "./tools";

type JsonRecord = Record<string, unknown>;

const PLUGIN_VERSION = "1.0.0";
const PROTOCOL_VERSION = "1";
const DISPLAY_NAME = "Todoist";
const DESCRIPTION = "Connect to Todoist to manage and summarize your tasks";

function isConnected(config: JsonRecord, state: JsonRecord): boolean {
	return Boolean(state.connectedAt) || hasTodoistApiKey(config);
}

function buildChatModelPrep() {
	return {
		systemPromptSection: TODOIST_SYSTEM_PROMPT_SECTION,
		singleSessionRules: TODOIST_SINGLE_SESSION_RULES,
		singleSessionUserTemplate: TODOIST_SINGLE_SESSION_USER_TEMPLATE,
		multiUserContentTemplate: TODOIST_MULTI_USER_CONTENT_TEMPLATE,
	};
}

function buildChatReadiness(
	config: JsonRecord,
	state: JsonRecord,
): { ok: boolean; hint?: string } {
	if (state.connectedAt || hasTodoistApiKey(config)) {
		return { ok: true };
	}
	return {
		ok: false,
		hint: "Add a Todoist API key in `toby configure` or run `toby connect todoist`.",
	};
}

async function validateTodoistTools(
	config: JsonRecord,
): Promise<Array<{ tool: string; ok: boolean; details: string }>> {
	const checks: Array<{ tool: string; ok: boolean; details: string }> = [];
	const availableTools = new Set(TOOL_DEFINITIONS.map((tool) => tool.name));

	try {
		await fetchOpenTasks(config, 1);
		checks.push({
			tool: "fetchOpenTasks",
			ok: true,
			details: "Fetched open tasks successfully.",
		});
	} catch (error) {
		checks.push({
			tool: "fetchOpenTasks",
			ok: false,
			details: toErrorMessage(error),
		});
	}

	try {
		await fetchCompletedTasks(config, 1);
		checks.push({
			tool: "fetchCompletedTasks",
			ok: true,
			details: "Fetched completed tasks successfully.",
		});
	} catch (error) {
		checks.push({
			tool: "fetchCompletedTasks",
			ok: false,
			details: toErrorMessage(error),
		});
	}

	try {
		await fetchProjects(config);
		checks.push({
			tool: "listProjectNames",
			ok: true,
			details: "Fetched Todoist projects successfully.",
		});
	} catch (error) {
		checks.push({
			tool: "listProjectNames",
			ok: false,
			details: toErrorMessage(error),
		});
	}

	checks.push({
		tool: "getProjectNameById",
		ok: availableTools.has("getProjectNameById"),
		details: availableTools.has("getProjectNameById")
			? "Project ID -> name resolution is available."
			: "Tool is not available in the Todoist toolset.",
	});
	for (const tool of ["completeTask", "updateTask", "createTask"]) {
		checks.push({
			tool,
			ok: availableTools.has(tool),
			details: availableTools.has(tool)
				? "Write endpoint assumed available with the same API key (not executed)."
				: "Tool is not available in the Todoist toolset.",
		});
	}

	return checks;
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
		name: "todoist",
		displayName: DISPLAY_NAME,
		description: DESCRIPTION,
		version: PLUGIN_VERSION,
		protocolVersion: PROTOCOL_VERSION,
		icon: "✅",
		connected,
		capabilities: ["chat"],
		providerCategories: ["tasks"],
		resources: ["tasks", "projects"],
		chatModelPrep: buildChatModelPrep(),
		chatReadiness: buildChatReadiness(config, state),
		details: connected
			? "Todoist API reachable."
			: "Todoist is not connected. Run `toby connect todoist` after configuring your API key.",
	};

	if (state.connectedAt && hasTodoistApiKey(config)) {
		try {
			await testTodoistConnection(config);
			payload.details = "Todoist API reachable.";
		} catch (error) {
			payload.ok = false;
			payload.details = `Connected, but Todoist API check failed: ${toErrorMessage(error)}`;
		}
	} else if (hasTodoistApiKey(config) && !state.connectedAt) {
		payload.details =
			"Todoist API key configured. Run `toby connect todoist` to mark connected, or use chat directly.";
	}

	if (validateTools && hasTodoistApiKey(config)) {
		const toolChecks = await validateTodoistTools(config);
		payload.tools = toolChecks;
		const failedChecks = toolChecks.filter((check) => !check.ok);
		if (failedChecks.length === 0) {
			payload.details = `Successfully authenticated and validated ${toolChecks.length}/${toolChecks.length} tools.`;
		} else {
			payload.ok = failedChecks.length === 0;
			payload.details = `Connected, but ${failedChecks.length}/${toolChecks.length} tool checks failed.`;
		}
	}

	emitJson(payload);
}

async function handleConnect(config: JsonRecord): Promise<never> {
	if (!hasTodoistApiKey(config)) {
		emitJson({
			ok: false,
			reason:
				"Todoist requires an API key. Add it in `toby configure` under Todoist.",
		});
	}

	try {
		await testTodoistConnection(config);
		emitJson({
			ok: true,
			reason: "Todoist connected successfully.",
		});
	} catch (error) {
		emitJson({
			ok: false,
			reason: `Todoist credentials are invalid or missing permissions: ${toErrorMessage(error)}`,
		});
	}
}

function handleDisconnect(): never {
	emitJson({
		ok: true,
		reason: "Todoist disconnected.",
	});
}

function handleConfigShape(): never {
	emitJson({
		ok: true,
		fields: [
			{
				key: "apiKey",
				label: "API Key",
				type: "string",
				required: true,
				masked: true,
			},
		],
	});
}

function handleConfigGet(config: JsonRecord): never {
	emitJson({
		ok: true,
		config: normalizeConfig(config),
	});
}

function handleConfigSet(): never {
	emitJson({ ok: true, reason: "Todoist config synced." });
}

function handleToolsList(): never {
	emitJson({
		ok: true,
		tools: TOOL_DEFINITIONS,
	});
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
