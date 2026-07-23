import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isIntegrationUsableInChat } from "@toby/core/chat-integrations";
import {
	getIntegrationModule,
	getIntegrationModules,
} from "@toby/core/integrations/index";
import {
	createPluginIntegrationModule,
	inspectPluginBinary,
	loadPluginMetadata,
} from "@toby/core/integrations/plugins/adapter";
import {
	pluginConfigShape,
	pluginConnect,
	pluginStatus,
	pluginToolsExecute,
	pluginToolsList,
} from "@toby/core/integrations/plugins/client";
import {
	discoverPluginBinaries,
	resolveActivePluginDirectory,
	resolvePluginSearchDirectories,
} from "@toby/core/integrations/plugins/discovery";
import { jsonSchemaToZod } from "@toby/core/integrations/plugins/json-schema";
import { collectPluginListEntries } from "@toby/core/integrations/plugins/list-status";
import { parsePluginNameFromBinary } from "@toby/core/integrations/plugins/protocol";
import {
	getPluginModules,
	resetPluginModuleCache,
} from "@toby/core/integrations/plugins/registry";
import { resolveBunRuntime } from "@toby/core/integrations/plugins/runtime";
import { buildIntegrationSetupGuide } from "@toby/core/integrations/plugins/setup";

const SAMPLE_PLUGIN_SCRIPT = `
type JsonRecord = Record<string, unknown>;

function readStdin(): Promise<string> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
		process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		if (process.stdin.isTTY) resolve("");
	});
}

function emitJson(payload: JsonRecord, exitCode = 0): never {
	process.stdout.write(JSON.stringify(payload) + "\\n");
	process.exit(exitCode);
}

function parseEnvelope(raw: string): { config: JsonRecord; state: JsonRecord } {
	if (!raw.trim()) return { config: {}, state: {} };
	try {
		const parsed = JSON.parse(raw) as JsonRecord;
		const config = parsed.config && typeof parsed.config === "object" && !Array.isArray(parsed.config) ? parsed.config as JsonRecord : {};
		const state = parsed.state && typeof parsed.state === "object" && !Array.isArray(parsed.state) ? parsed.state as JsonRecord : {};
		return { config, state };
	} catch { emitJson({ ok: false, error: "Invalid JSON", code: "invalid_input" }, 2); }
}

async function main() {
	const [command, subcommand] = process.argv.slice(2);
	const stdin = await readStdin();

	if (command === "status") {
		const { config, state } = parseEnvelope(stdin);
		const connected = Boolean(state.connectedAt) || String(config.apiKey ?? "").trim().length > 0;
		emitJson({ ok: true, name: "sample", displayName: "Sample Plugin", description: "Reference installable plugin for Toby protocol v1", version: "1.0.0", protocolVersion: "1", connected, capabilities: ["chat"], resources: ["demo"], chatModelPrep: { systemPromptSection: "### Sample Plugin\\nDemo installable plugin for search-style chat tools.", singleSessionRules: "You are assisting via the Sample Plugin integration. Use sample tools when helpful.", singleSessionUserTemplate: "{{userPrompt}}", multiUserContentTemplate: '## Sample Plugin context\\nUse sample tools when the user request benefits from them.\\n\\nQuery: \"{{userPrompt}}\"' }, setupAvailable: true, setupDescription: "Demo setup for protocol testing", details: connected ? "Sample plugin configured." : "Configure sample.apiKey in Toby configure." });
	}
	if (command === "connect") {
		const { config } = parseEnvelope(stdin);
		const apiKey = String(config.apiKey ?? "").trim();
		if (!apiKey) emitJson({ ok: false, reason: "API key is required." });
		emitJson({ ok: true, reason: "Sample plugin connection validated." });
	}
	if (command === "disconnect") emitJson({ ok: true, reason: "Sample plugin disconnected." });
	if (command === "config" && subcommand === "shape") {
		emitJson({ ok: true, fields: [{ key: "apiKey", label: "API Key", type: "string", required: true, masked: true, description: "Demo credential" }, { key: "greeting", label: "Greeting prefix", type: "string", required: false, default: "Hello" }] });
	}
	if (command === "config" && subcommand === "get") {
		const { config } = parseEnvelope(stdin);
		emitJson({ ok: true, config: { apiKey: String(config.apiKey ?? ""), greeting: String(config.greeting ?? "Hello") } });
	}
	if (command === "config" && subcommand === "set") emitJson({ ok: true, reason: "Sample plugin config synced." });
	if (command === "tools" && subcommand === "list") {
		emitJson({ ok: true, tools: [{ name: "sampleEcho", description: "Echo a message", readOnly: true, inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] } }, { name: "sampleMutate", description: "Record a demo mutation", readOnly: false, inputSchema: { type: "object", properties: { note: { type: "string" } }, required: ["note"] } }] });
	}
	if (command === "tools" && subcommand === "execute") {
		const body = JSON.parse(stdin) as JsonRecord;
		const tool = String(body.tool ?? "");
		const input = body.input && typeof body.input === "object" ? body.input as JsonRecord : {};
		const config = body.config && typeof body.config === "object" ? body.config as JsonRecord : {};
		const dryRun = Boolean(body.dryRun);
		const greeting = String(config.greeting ?? "Hello").trim() || "Hello";
		if (tool === "sampleEcho") {
			const message = String(input.message ?? "").trim();
			if (!message) emitJson({ ok: false, error: "message is required" });
			emitJson({ ok: true, result: { echo: greeting + ", " + message + "!" } });
		}
		if (tool === "sampleMutate") {
			const note = String(input.note ?? "").trim();
			if (!note) emitJson({ ok: false, error: "note is required" });
			if (dryRun) emitJson({ ok: true, result: { dryRun: true, wouldRecord: note }, appliedActions: ["Would record note: " + note] });
			emitJson({ ok: true, result: { recorded: note }, appliedActions: ["Recorded note: " + note] });
		}
		emitJson({ ok: false, error: "Unknown tool: " + tool });
	}
	if (command === "setup") emitJson({ ok: true, actions: [{ id: "demo:already-done", label: "Demo prerequisite check", ok: true, skipped: true, detail: "Already satisfied." }, { id: "demo:install", label: "Demo install step", ok: true, detail: "Completed successfully." }] });
	if (command === "setup" && subcommand === "guide") {
		emitJson({ ok: true, name: "sample", displayName: "Sample Plugin", description: "Reference installable plugin", steps: [{ id: "overview", title: "What the Sample Plugin does", description: "The Sample Plugin demonstrates Toby protocol v1." }, { id: "credentials", title: "Add credentials", description: "Enter the API key in the fields below, then connect.", artifacts: [{ id: "redirectUri", label: "Demo redirect URI", value: "http://localhost:9999/callback", hint: "Paste this into the provider console if asked." }] }, { id: "validate", title: "Validate", description: "Click Connect to finish the demo setup." }] });
	}
	emitJson({ ok: false, error: "Unknown command: " + (command ?? "(none)"), code: "usage" }, 2);
}
main().catch((e) => emitJson({ ok: false, error: e instanceof Error ? e.message : String(e), code: "internal_error" }, 2));
`;

function writeSamplePluginWrapper(pluginDir: string): string {
	fs.mkdirSync(pluginDir, { recursive: true });
	const scriptPath = path.join(pluginDir, "sample-fixture.ts");
	fs.writeFileSync(scriptPath, SAMPLE_PLUGIN_SCRIPT, { mode: 0o644 });
	const wrapperPath = path.join(pluginDir, "toby-plugin-sample");
	const script = `#!/usr/bin/env bash\nexec bun ${JSON.stringify(scriptPath)} "$@"\n`;
	fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
	return wrapperPath;
}

describe("plugin protocol", () => {
	let tempDir: string;
	let pluginDir: string;
	let previousTobyDir: string | undefined;
	let previousTobyPluginsDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-plugin-test-"));
		pluginDir = path.join(tempDir, "toby-home", "plugins");
		previousTobyDir = process.env.TOBY_DIR;
		previousTobyPluginsDir = process.env.TOBY_PLUGINS_DIR;
		process.env.TOBY_DIR = path.join(tempDir, "toby-home");
		process.env.TOBY_PLUGINS_DIR = pluginDir;
		resetPluginModuleCache();
		writeSamplePluginWrapper(pluginDir);
	});

	afterEach(() => {
		if (previousTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		if (previousTobyPluginsDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_PLUGINS_DIR");
		} else {
			process.env.TOBY_PLUGINS_DIR = previousTobyPluginsDir;
		}
		resetPluginModuleCache();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("discovers plugin binaries by naming convention", () => {
		const discovered = discoverPluginBinaries();
		expect(discovered.some((p) => p.binaryName === "toby-plugin-sample")).toBe(
			true,
		);
		expect(parsePluginNameFromBinary("toby-plugin-sample")).toBe("sample");
	});

	it("collects plugin list entries with valid sample metadata", () => {
		const entries = collectPluginListEntries();
		const sample = entries.find((entry) => entry.name === "sample");
		expect(sample).toBeDefined();
		expect(sample?.state).toBe("valid");
		expect(sample?.displayName).toBeTruthy();
		expect(sample?.connected).toBe(false);
	});

	it("returns status metadata with supported protocol version", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-sample");
		const status = pluginStatus(binaryPath, {
			config: { apiKey: "demo" },
		});
		expect(status.ok).toBe(true);
		if (!status.ok) return;
		expect(status.data.ok).toBe(true);
		expect(status.data.name).toBe("sample");
		expect(status.data.protocolVersion).toBe("1");
	});

	it("connect fails without apiKey and succeeds with config", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-sample");
		const fail = pluginConnect(binaryPath, { config: {} });
		expect(fail.ok).toBe(true);
		if (!fail.ok) return;
		expect(fail.data.ok).toBe(false);

		const ok = pluginConnect(binaryPath, { config: { apiKey: "demo" } });
		expect(ok.ok).toBe(true);
		if (!ok.ok) return;
		expect(ok.data.ok).toBe(true);
	});

	it("lists and executes sample tools", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-sample");
		const list = pluginToolsList(binaryPath);
		expect(list.ok).toBe(true);
		if (!list.ok || !list.data.tools) return;
		expect(list.data.tools.map((t) => t.name)).toContain("sampleEcho");

		const exec = pluginToolsExecute(binaryPath, {
			tool: "sampleEcho",
			input: { message: "world" },
			config: { greeting: "Hi" },
			dryRun: false,
		});
		expect(exec.ok).toBe(true);
		if (!exec.ok) return;
		expect(exec.data.ok).toBe(true);
		expect(exec.data.result).toEqual({ echo: "Hi, world!" });
	});

	it("maps config shape fields to credential descriptors", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-sample");
		const shape = pluginConfigShape(binaryPath);
		expect(shape.ok).toBe(true);
		if (!shape.ok || !shape.data.fields) return;
		expect(shape.data.fields.some((f) => f.key === "apiKey")).toBe(true);

		const metadata = loadPluginMetadata({
			kind: "binary",
			binaryPath,
			binaryName: "toby-plugin-sample",
		});
		expect("error" in metadata).toBe(false);
		if ("error" in metadata) return;

		const module = createPluginIntegrationModule(metadata);
		const keys = module.getCredentialDescriptors().map((d) => d.key);
		expect(keys).toContain("sample.apiKey");
	});

	it("registers plugin-backed integration modules", () => {
		const sample = getIntegrationModule("sample");
		expect(sample).toBeDefined();
		expect(sample?.displayName).toBe("Sample Plugin");
		expect(sample?.capabilities).toContain("chat");
		expect(typeof sample?.createChatTools).toBe("function");
	});

	it("includes plugin modules in integration registry listing", () => {
		const names = getIntegrationModules().map((m) => m.name);
		expect(names).toContain("sample");
	});

	it("unconnected plugin without chatReadiness is not usable in chat", async () => {
		const sample = getIntegrationModule("sample");
		expect(sample).toBeDefined();
		if (!sample) return;
		// The sample plugin does not return chatReadiness in its status response.
		// An unconnected plugin must NOT be considered usable in chat, otherwise
		// it appears in connectedIntegrations and falsely completes the onboarding
		// "Connect integrations" step.
		const usable = await isIntegrationUsableInChat(sample);
		expect(usable).toBe(false);
	});

	it("inspectPluginBinary surfaces load failures", () => {
		const inspected = inspectPluginBinary({
			kind: "binary",
			binaryPath: path.join(pluginDir, "missing-plugin"),
			binaryName: "toby-plugin-missing",
		});
		expect("error" in inspected).toBe(true);
	});

	it("resolvePluginSearchDirectories includes the Toby plugins directory", () => {
		Reflect.deleteProperty(process.env, "TOBY_PLUGINS_DIR");
		const dirs = resolvePluginSearchDirectories();
		expect(dirs).toContain(path.resolve(pluginDir));
		expect(dirs.at(-1)).toBe(path.resolve(pluginDir));
	});

	it("resolvePluginSearchDirectories uses TOBY_PLUGINS_DIR exclusively when set", () => {
		const extraDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "toby-plugins-env-test-"),
		);
		const previous = process.env.TOBY_PLUGINS_DIR;
		try {
			process.env.TOBY_PLUGINS_DIR = extraDir;
			const dirs = resolvePluginSearchDirectories();
			expect(dirs).toEqual([extraDir]);
		} finally {
			if (previous === undefined) {
				Reflect.deleteProperty(process.env, "TOBY_PLUGINS_DIR");
			} else {
				process.env.TOBY_PLUGINS_DIR = previous;
			}
			fs.rmSync(extraDir, { recursive: true, force: true });
		}
	});

	it("resolvePluginSearchDirectories prefers plugins next to the running executable", () => {
		Reflect.deleteProperty(process.env, "TOBY_PLUGINS_DIR");
		const executableDir = path.join(tempDir, "bundle", "Contents", "Resources");
		fs.mkdirSync(executableDir, { recursive: true });
		writeSamplePluginWrapper(executableDir);

		const descriptor = Object.getOwnPropertyDescriptor(process, "execPath");
		Object.defineProperty(process, "execPath", {
			configurable: true,
			value: path.join(executableDir, "toby"),
		});

		try {
			const dirs = resolvePluginSearchDirectories();
			expect(dirs[0]).toBe(executableDir);
			expect(resolveActivePluginDirectory()).toBe(executableDir);
		} finally {
			if (descriptor) {
				Object.defineProperty(process, "execPath", descriptor);
			}
		}
	});

	it("converts plugin JSON schema properties to zod", () => {
		const schema = jsonSchemaToZod({
			type: "object",
			properties: {
				message: { type: "string", description: "msg" },
				count: { type: "number" },
			},
			required: ["message"],
		});
		expect(schema.safeParse({ message: "hi" }).success).toBe(true);
		expect(schema.safeParse({}).success).toBe(false);
	});

	it("getPluginModules returns adapter instances", () => {
		const modules = getPluginModules();
		expect(modules.some((m) => m.name === "sample")).toBe(true);
	});

	it("buildIntegrationSetupGuide returns a guide with provider steps", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-sample");
		const metadata = loadPluginMetadata({
			kind: "binary",
			binaryPath,
			binaryName: "toby-plugin-sample",
		});
		expect("error" in metadata).toBe(false);
		if ("error" in metadata) return;

		const module = createPluginIntegrationModule(metadata);
		const guide = buildIntegrationSetupGuide(module);
		expect(guide.ok).toBe(true);
		if (!guide.ok) return;
		expect(guide.steps.map((s) => s.id)).toContain("overview");
		expect(guide.steps.map((s) => s.id)).toContain("credentials");
		expect(guide.steps.map((s) => s.id)).toContain("validate");
	});
});

describe("resolveBunRuntime sibling resolution", () => {
	let tempDir: string;
	let previousTobyDir: string | undefined;
	const originalExecPath = process.execPath;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-bun-runtime-"));
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = tempDir;
	});

	afterEach(() => {
		if (previousTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		Reflect.deleteProperty(process.env, "TOBY_BUN_PATH");
		Object.defineProperty(process, "execPath", {
			value: originalExecPath,
		});
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("finds bun next to the running executable (self-contained app)", () => {
		const appResources = path.join(
			tempDir,
			"Toby.app",
			"Contents",
			"Resources",
		);
		fs.mkdirSync(appResources, { recursive: true });
		const tobyPath = path.join(appResources, "toby");
		const bunPath = path.join(appResources, "bun");
		fs.writeFileSync(tobyPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
		fs.writeFileSync(bunPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

		Object.defineProperty(process, "execPath", { value: tobyPath });
		const result = resolveBunRuntime();
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.bunPath).toBe(bunPath);
		}
	});

	it("falls back to ~/.toby/helpers/bun when no sibling exists", () => {
		const binDir = path.join(tempDir, "bin");
		fs.mkdirSync(binDir, { recursive: true });
		const tobyPath = path.join(binDir, "toby");
		fs.writeFileSync(tobyPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

		const helpersDir = path.join(tempDir, "helpers");
		fs.mkdirSync(helpersDir, { recursive: true });
		const helpersBun = path.join(helpersDir, "bun");
		fs.writeFileSync(helpersBun, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

		Object.defineProperty(process, "execPath", { value: tobyPath });
		const result = resolveBunRuntime();
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.bunPath).toBe(helpersBun);
		}
	});
});
