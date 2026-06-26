#!/usr/bin/env bun
/**
 * Reference installable Toby TypeScript plugin (bun-package, protocol v1).
 *
 * Unlike the binary sample plugin (apps/plugin-sample), this plugin is not
 * compiled with `bun build --compile`. Toby discovers the directory, reads
 * manifest.json, and invokes this entry point via `bun run src/index.ts`.
 */

type JsonRecord = Record<string, unknown>;

const PLUGIN_VERSION = "1.0.0";
const PROTOCOL_VERSION = "1";

function readStdin(): Promise<string> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
		process.stdin.on("end", () =>
			resolve(Buffer.concat(chunks).toString("utf8")),
		);
		if (process.stdin.isTTY) {
			resolve("");
		}
	});
}

function parseEnvelope(raw: string): { config: JsonRecord; state: JsonRecord } {
	if (!raw.trim()) {
		return { config: {}, state: {} };
	}
	try {
		const parsed = JSON.parse(raw) as JsonRecord;
		const config =
			parsed.config &&
			typeof parsed.config === "object" &&
			!Array.isArray(parsed.config)
				? (parsed.config as JsonRecord)
				: {};
		const state =
			parsed.state &&
			typeof parsed.state === "object" &&
			!Array.isArray(parsed.state)
				? (parsed.state as JsonRecord)
				: {};
		return { config, state };
	} catch {
		emitError("Invalid JSON on stdin", "invalid_input", 2);
	}
}

function emitJson(payload: JsonRecord, exitCode = 0): never {
	process.stdout.write(`${JSON.stringify(payload)}\n`);
	process.exit(exitCode);
}

function emitError(message: string, code: string, exitCode: 1 | 2 = 1): never {
	emitJson({ ok: false, error: message, code }, exitCode);
}

function isConnected(config: JsonRecord, state: JsonRecord): boolean {
	return (
		Boolean(state.connectedAt) || String(config.apiKey ?? "").trim().length > 0
	);
}

function handleStatus(config: JsonRecord, state: JsonRecord): never {
	const connected = isConnected(config, state);
	emitJson({
		ok: true,
		name: "sample-ts",
		displayName: "Sample TypeScript Plugin",
		description:
			"Reference installable TypeScript (bun-package) plugin for Toby protocol v1",
		version: PLUGIN_VERSION,
		protocolVersion: PROTOCOL_VERSION,
		connected,
		capabilities: ["chat"],
		providerCategories: ["search"],
		resources: ["demo"],
		chatModelPrep: {
			systemPromptSection:
				"### Sample TypeScript Plugin\nDemo bun-package plugin for search-style chat tools.",
			singleSessionRules:
				"You are assisting via the Sample TypeScript Plugin integration. Use sampleTs tools when helpful.",
			singleSessionUserTemplate: "{{userPrompt}}",
			multiUserContentTemplate:
				'## Sample TypeScript Plugin context\nUse sampleTs tools when the user request benefits from them.\n\nQuery: "{{userPrompt}}"',
		},
		setupAvailable: true,
		setupDescription: "Demo setup for protocol testing",
		details: connected
			? "Sample TypeScript plugin configured."
			: "Configure sample-ts.apiKey in Toby configure.",
	});
}

function handleSetup(): never {
	emitJson({
		ok: true,
		actions: [
			{
				id: "demo:already-done",
				label: "Demo prerequisite check",
				ok: true,
				skipped: true,
				detail: "Already satisfied.",
			},
			{
				id: "demo:install",
				label: "Demo install step",
				ok: true,
				detail: "Completed successfully.",
			},
		],
	});
}

function handleSetupGuide(): never {
	emitJson({
		ok: true,
		name: "sample-ts",
		displayName: "Sample TypeScript Plugin",
		description:
			"Reference installable TypeScript (bun-package) plugin for Toby protocol v1",
		steps: [
			{
				id: "overview",
				title: "What the Sample TypeScript Plugin does",
				description:
					"The Sample TypeScript Plugin demonstrates Toby protocol v1 as a bun-package (directory) plugin. It adds a sampleTsEcho tool for chat.",
			},
			{
				id: "credentials",
				title: "Add credentials",
				description: "Enter the API key in the fields below, then connect.",
				artifacts: [
					{
						id: "redirectUri",
						label: "Demo redirect URI",
						value: "http://localhost:9999/callback",
						hint: "Paste this into the provider console if asked.",
					},
				],
			},
			{
				id: "validate",
				title: "Validate",
				description: "Click Connect to finish the demo setup.",
			},
		],
	});
}

function handleConnect(config: JsonRecord): never {
	const apiKey = String(config.apiKey ?? "").trim();
	if (!apiKey) {
		emitJson({ ok: false, reason: "API key is required." });
	}
	emitJson({
		ok: true,
		reason: "Sample TypeScript plugin connection validated.",
	});
}

function handleDisconnect(): never {
	emitJson({ ok: true, reason: "Sample TypeScript plugin disconnected." });
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
				description: "Demo credential used by the sample TypeScript plugin",
			},
			{
				key: "greeting",
				label: "Greeting prefix",
				type: "string",
				required: false,
				default: "Hello",
			},
		],
	});
}

function handleConfigGet(config: JsonRecord): never {
	emitJson({
		ok: true,
		config: {
			apiKey: String(config.apiKey ?? ""),
			greeting: String(config.greeting ?? "Hello"),
		},
	});
}

function handleConfigSet(): never {
	emitJson({ ok: true, reason: "Sample TypeScript plugin config synced." });
}

function handleToolsList(): never {
	emitJson({
		ok: true,
		tools: [
			{
				name: "sampleTsEcho",
				description: "Echo a message using the configured greeting prefix",
				readOnly: true,
				inputSchema: {
					type: "object",
					properties: {
						message: {
							type: "string",
							description: "Message to echo",
						},
					},
					required: ["message"],
				},
			},
			{
				name: "sampleTsMutate",
				description: "Record a demo mutation (respects dryRun)",
				readOnly: false,
				inputSchema: {
					type: "object",
					properties: {
						note: {
							type: "string",
							description: "Note to record",
						},
					},
					required: ["note"],
				},
			},
		],
	});
}

function handleToolsExecute(body: JsonRecord): never {
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
	const greeting = String(config.greeting ?? "Hello").trim() || "Hello";

	if (tool === "sampleTsEcho") {
		const message = String(input.message ?? "").trim();
		if (!message) {
			emitJson({ ok: false, error: "message is required" });
		}
		emitJson({
			ok: true,
			result: { echo: `${greeting}, ${message}!` },
		});
	}

	if (tool === "sampleTsMutate") {
		const note = String(input.note ?? "").trim();
		if (!note) {
			emitJson({ ok: false, error: "note is required" });
		}
		if (dryRun) {
			emitJson({
				ok: true,
				result: { dryRun: true, wouldRecord: note },
				appliedActions: [`Would record note: ${note}`],
			});
		}
		emitJson({
			ok: true,
			result: { recorded: note },
			appliedActions: [`Recorded note: ${note}`],
		});
	}

	emitJson({ ok: false, error: `Unknown tool: ${tool}` });
}

async function main(): Promise<void> {
	const [command, subcommand] = process.argv.slice(2);
	const stdin = await readStdin();

	if (command === "status") {
		const { config, state } = parseEnvelope(stdin);
		handleStatus(config, state);
	}

	if (command === "connect") {
		const { config } = parseEnvelope(stdin);
		handleConnect(config);
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
		handleToolsExecute(body);
	}

	if (command === "setup") {
		handleSetup();
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
