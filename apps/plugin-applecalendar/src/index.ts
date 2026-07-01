#!/usr/bin/env bun
/**
 * Apple Calendar installable Toby plugin (protocol v1, bun-package).
 *
 * This plugin delegates all calendar operations to Toby.app's native API
 * server (localhost). The TypeScript plugin is a thin protocol adapter that
 * forwards tool executions to the app's EventKit-backed calendar handler.
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

const PLUGIN_VERSION = "1.1.0";
const PROTOCOL_VERSION = "1";
const DISPLAY_NAME = "Apple Calendar";
const DESCRIPTION =
	"Manage local Calendar.app on macOS — search, create, update, and delete events";

const RESOURCES = ["calendars", "events"];

function validateSubtools(): JsonRecord[] {
	const checks: JsonRecord[] = [];
	const r = nativeRequest("calendar/list");
	checks.push({
		tool: "listCalendars",
		ok: r.ok,
		details: r.ok ? "reachable" : (r.error ?? "failed"),
	});
	const r2 = nativeRequest("calendar/search", { limit: 1 });
	checks.push({
		tool: "searchCalendarEvents",
		ok: r2.ok,
		details: r2.ok ? "search completed" : (r2.error ?? "failed"),
	});
	checks.push({
		tool: "getCalendarEvent",
		ok: true,
		details: "Not executed; requires an event uid from searchCalendarEvents.",
	});
	checks.push({
		tool: "createCalendarEvent",
		ok: true,
		details:
			"Not executed; event creation requires explicit user action in chat.",
	});
	checks.push({
		tool: "updateCalendarEvent",
		ok: true,
		details:
			"Not executed; event updates require a uid from searchCalendarEvents or createCalendarEvent.",
	});
	checks.push({
		tool: "deleteCalendarEvent",
		ok: true,
		details:
			"Not executed; event deletion requires a uid from searchCalendarEvents or createCalendarEvent.",
	});
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
		name: "applecalendar",
		displayName: DISPLAY_NAME,
		description: DESCRIPTION,
		version: PLUGIN_VERSION,
		protocolVersion: PROTOCOL_VERSION,
		icon: "📅",
		iconAsset: {
			path: "assets/icon-256.png",
			mimeType: "image/png",
		},
		connected,
		capabilities: ["chat"],
		providerCategories: ["calendar"],
		resources: RESOURCES,
		chatModelPrep: buildChatModelPrep(),
		chatReadiness: buildChatReadiness(state),
	};

	if (!nativeAvailable) {
		payload.connected = false;
		payload.details =
			"Toby.app is not running. Launch Toby.app to enable Apple Calendar tools.";
		emitJson(payload);
	}

	if (connected) {
		const smoke = nativeRequest("calendar/list");
		if (smoke.ok) {
			payload.details = "Calendar.app reachable.";
		} else {
			payload.ok = false;
			payload.details = `Connected, but Calendar.app check failed: ${smoke.error ?? "unknown"}`;
		}
	} else {
		payload.details =
			"Apple Calendar is not connected. Run `toby connect applecalendar` on this Mac first.";
	}

	if (validateTools && connected) {
		const toolChecks = validateSubtools();
		payload.tools = toolChecks;
		const failed = toolChecks.filter((c) => c.ok !== true);
		if (failed.length === 0) {
			payload.details = `Calendar.app reachable; validated ${toolChecks.length} tool check(s).`;
			payload.ok = true;
		} else {
			payload.ok = false;
			payload.details = `Connected, but ${failed.length}/${toolChecks.length} tool check(s) failed.`;
		}
	} else if (connected && !validateTools) {
		payload.details =
			"Apple Calendar is configured; full Calendar.app validation skipped.";
	}

	emitJson(payload);
}

function handleConnect(): never {
	if (!isNativeAvailable()) {
		emitJson({
			ok: false,
			reason:
				"Toby.app is not running. Launch Toby.app to connect Apple Calendar.",
		});
	}
	const smoke = nativeRequest("calendar/list");
	if (smoke.ok) {
		emitJson({ ok: true, reason: "Apple Calendar connected successfully." });
	}
	emitJson({
		ok: false,
		reason: `Calendar.app check failed: ${smoke.error ?? "unknown"}`,
	});
}

function handleDisconnect(): never {
	emitJson({ ok: true, reason: "Apple Calendar disconnected." });
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
