#!/usr/bin/env bun
/**
 * Apple Reminders installable Toby plugin (protocol v1, bun-package).
 *
 * This plugin delegates all reminder operations to Toby.app's native API
 * server (localhost). The TypeScript plugin is a thin protocol adapter that
 * forwards tool executions to the app's EventKit-backed reminders handler.
 */

import { isNativeAvailable, nativeRequest } from "./native-client";
import { buildChatModelPrep, buildChatReadiness } from "./prompts";
import {
	emitError,
	emitJson,
	isConnected,
	parseEnvelope,
	readStdin,
} from "./protocol";
import { TOOL_DEFINITIONS, ToolFailure, executeTool } from "./tools";

type JsonRecord = Record<string, unknown>;

const PLUGIN_VERSION = "1.0.0";
const PROTOCOL_VERSION = "1";
const DISPLAY_NAME = "Apple Reminders";
const DESCRIPTION =
	"Manage local Reminders.app on macOS — search, create, update, complete, and delete reminders";

const RESOURCES = ["lists", "reminders"];

function validateSubtools(): JsonRecord[] {
	const checks: JsonRecord[] = [];
	const r = nativeRequest("reminders/lists");
	checks.push({
		tool: "listReminderLists",
		ok: r.ok,
		details: r.ok ? "reachable" : (r.error ?? "failed"),
	});
	const r2 = nativeRequest("reminders/search", { limit: 1 });
	checks.push({
		tool: "searchReminders",
		ok: r2.ok,
		details: r2.ok ? "search completed" : (r2.error ?? "failed"),
	});
	for (const tool of [
		"getReminder",
		"createReminder",
		"updateReminder",
		"completeReminder",
		"deleteReminder",
	]) {
		checks.push({
			tool,
			ok: true,
			details:
				"Not executed; this tool requires an explicit reminder id or user action in chat.",
		});
	}
	return checks;
}

function handleStatus(
	config: JsonRecord,
	state: JsonRecord,
	validateTools: boolean,
): never {
	const nativeAvailable = isNativeAvailable();
	const connected = nativeAvailable && isConnected(state);

	const payload: JsonRecord = {
		ok: true,
		name: "applereminders",
		displayName: DISPLAY_NAME,
		description: DESCRIPTION,
		version: PLUGIN_VERSION,
		protocolVersion: PROTOCOL_VERSION,
		icon: "☑️",
		iconAsset: {
			path: "assets/icon-48.png",
			mimeType: "image/png",
		},
		connected,
		capabilities: ["chat"],
		providerCategories: ["tasks"],
		resources: RESOURCES,
		chatModelPrep: buildChatModelPrep(),
		chatReadiness: buildChatReadiness(state),
	};

	if (!nativeAvailable) {
		payload.connected = false;
		payload.details =
			"Toby.app is not running. Launch Toby.app to enable Apple Reminders tools.";
		emitJson(payload);
	}

	if (connected) {
		const smoke = nativeRequest("reminders/lists");
		if (smoke.ok) {
			payload.details = "Reminders.app reachable.";
		} else {
			payload.ok = false;
			payload.details = `Connected, but Reminders.app check failed: ${smoke.error ?? "unknown"}`;
		}
	} else {
		payload.details =
			"Apple Reminders is not connected. Run `toby connect applereminders` on this Mac first.";
	}

	if (validateTools && connected) {
		const toolChecks = validateSubtools();
		payload.tools = toolChecks;
		const failed = toolChecks.filter((c) => c.ok !== true);
		if (failed.length === 0) {
			payload.details = `Reminders.app reachable; validated ${toolChecks.length} tool check(s).`;
			payload.ok = true;
		} else {
			payload.ok = false;
			payload.details = `Connected, but ${failed.length}/${toolChecks.length} tool check(s) failed.`;
		}
	} else if (connected && !validateTools) {
		payload.details =
			"Apple Reminders is configured; full Reminders.app validation skipped.";
	}

	emitJson(payload);
}

function handleConnect(): never {
	if (!isNativeAvailable()) {
		emitJson({
			ok: false,
			reason:
				"Toby.app is not running. Launch Toby.app to connect Apple Reminders.",
		});
	}
	const access = nativeRequest("reminders/request-access");
	if (!access.ok) {
		emitJson({
			ok: false,
			reason: `Reminders.app access request failed: ${access.error ?? "unknown"}`,
		});
	}
	const smoke = nativeRequest("reminders/lists");
	if (smoke.ok) {
		emitJson({ ok: true, reason: "Apple Reminders connected successfully." });
	}
	emitJson({
		ok: false,
		reason: `Reminders.app check failed: ${smoke.error ?? "unknown"}`,
	});
}

function handleDisconnect(): never {
	emitJson({ ok: true, reason: "Apple Reminders disconnected." });
}

function handleConfigShape(): never {
	emitJson({ ok: true, fields: [] });
}

function handleConfigGet(config: JsonRecord): never {
	emitJson({ ok: true, config });
}

function handleConfigSet(): never {
	emitJson({ ok: true });
}

function handleToolsList(): never {
	emitJson({ ok: true, tools: TOOL_DEFINITIONS });
}

function handleToolsExecute(body: JsonRecord): never {
	const tool = String(body.tool ?? "");
	const input =
		body.input && typeof body.input === "object" && !Array.isArray(body.input)
			? (body.input as JsonRecord)
			: {};

	if (!TOOL_DEFINITIONS.some((def) => def.name === tool)) {
		emitJson({ ok: false, error: `Unknown tool: ${tool}` });
	}

	try {
		const { result, appliedActions } = executeTool(
			tool,
			input,
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

async function main(): Promise<void> {
	const [command, subcommand] = process.argv.slice(2);
	const stdin = await readStdin();

	if (command === "status") {
		const { config, state, validateTools } = parseEnvelope(stdin);
		handleStatus(config, state, validateTools);
	}

	if (command === "connect") {
		handleConnect();
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
			emitError("Invalid JSON on stdin", "invalid_input", 2);
		}
		try {
			const body = JSON.parse(stdin) as JsonRecord;
			handleToolsExecute(body);
		} catch {
			emitError("Invalid JSON on stdin", "invalid_input", 2);
		}
	}

	emitError(`Unknown command: ${command ?? "(none)"}`, "usage", 2);
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	emitError(message, "internal_error", 2);
});
