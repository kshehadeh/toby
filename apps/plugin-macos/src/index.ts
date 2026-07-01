#!/usr/bin/env bun
/**
 * macOS system control installable Toby plugin (protocol v1, bun-package).
 *
 * This plugin delegates all macOS-native operations to Toby.app's native API
 * server (localhost). The TypeScript plugin is a thin protocol adapter that
 * forwards tool executions and setup actions to the app.
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
import { runSetup } from "./setup";
import { TOOL_DEFINITIONS, ToolFailure, executeTool } from "./tools";

type JsonRecord = Record<string, unknown>;

const PLUGIN_VERSION = "1.1.0";
const PROTOCOL_VERSION = "1";
const DISPLAY_NAME = "macOS";
const DESCRIPTION =
	"Control this Mac locally — Wi‑Fi, Bluetooth, battery info, audio outputs, display brightness, volume, clipboard, low power probes";

const RESOURCES = [
	"wifi",
	"bluetooth",
	"battery",
	"audio",
	"powermode",
	"display",
	"clipboard",
	"focus",
];

function validateSubtools(): JsonRecord[] {
	const checks: JsonRecord[] = [];
	const r = nativeRequest("macos/wifi-status");
	checks.push({
		tool: "wifi status",
		ok: r.ok,
		details: r.ok ? "reachable" : (r.error ?? "failed"),
	});
	const r2 = nativeRequest("macos/battery-status");
	checks.push({
		tool: "battery status",
		ok: r2.ok,
		details: r2.ok ? "readable" : (r2.error ?? "failed"),
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
		name: "macos",
		displayName: DISPLAY_NAME,
		description: DESCRIPTION,
		version: PLUGIN_VERSION,
		protocolVersion: PROTOCOL_VERSION,
		icon: "🖥️",
		iconAsset: {
			path: "assets/icon-48.png",
			mimeType: "image/png",
		},
		connected,
		capabilities: ["chat"],
		resources: RESOURCES,
		chatModelPrep: buildChatModelPrep(),
		chatReadiness: buildChatReadiness(state),
	};

	if (nativeAvailable) {
		payload.setupAvailable = true;
		payload.setupDescription = "Install bundled Focus shortcuts for Toby";
	}

	if (!nativeAvailable) {
		payload.connected = false;
		payload.details =
			"Toby.app is not running. Launch Toby.app to enable macOS system tools.";
		emitJson(payload);
	}

	if (connected) {
		const smoke = nativeRequest("macos/system-info");
		if (smoke.ok) {
			payload.details = "macOS subsystem reachable.";
		} else {
			payload.ok = false;
			payload.details = `Connected, but subsystem check failed: ${smoke.error ?? "unknown"}`;
		}
	} else {
		payload.details =
			"macOS integration is not connected. Run `toby connect macos` on this Mac first.";
	}

	if (validateTools && connected) {
		const toolChecks = validateSubtools();
		payload.tools = toolChecks;
		const failed = toolChecks.filter((c) => c.ok !== true);
		if (failed.length === 0) {
			payload.details = `Subsystem probes reachable; validated ${toolChecks.length} tool check(s).`;
			payload.ok = true;
		} else {
			payload.ok = false;
			payload.details = `Connected, but ${failed.length}/${toolChecks.length} tool check(s) failed.`;
		}
	} else if (connected && !validateTools) {
		payload.details =
			"macOS integration is configured; full subsystem probes skipped.";
	}

	emitJson(payload);
}

function handleConnect(): never {
	if (!isNativeAvailable()) {
		emitJson({
			ok: false,
			reason:
				"Toby.app is not running. Launch Toby.app to connect macOS integration.",
		});
	}
	const smoke = nativeRequest("macos/system-info");
	if (smoke.ok) {
		emitJson({ ok: true, reason: "macOS integration connected successfully." });
	}
	emitJson({
		ok: false,
		reason: `macOS subsystem check failed: ${smoke.error ?? "unknown"}`,
	});
}

function handleDisconnect(): never {
	emitJson({ ok: true, reason: "macOS integration disconnected." });
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
	const dryRun = Boolean(body.dryRun);

	if (!TOOL_DEFINITIONS.some((def) => def.name === tool)) {
		emitJson({ ok: false, error: `Unknown tool: ${tool}` });
	}

	// macNotificationsPeek doesn't need the native server
	if (tool === "macNotificationsPeek") {
		emitJson({
			ok: true,
			result: {
				supported: false,
				message:
					"Toby cannot list Notification Center items via a stable public API. To turn Do Not Disturb / Focus on or off, use macFocusSet instead.",
			},
		});
	}

	try {
		const { result, appliedActions } = executeTool(tool, input, dryRun);
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

function handleSetup(): never {
	try {
		const actions = runSetup();
		emitJson({ ok: true, actions });
	} catch (error) {
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

	if (command === "setup") {
		handleSetup();
	}

	emitError(`Unknown command: ${command ?? "(none)"}`, "usage", 2);
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	emitError(message, "internal_error", 2);
});
