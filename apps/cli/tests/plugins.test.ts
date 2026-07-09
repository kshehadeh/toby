import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	getIntegrationModule,
	getIntegrationModules,
} from "@toby/core/integrations/index";
import { isIntegrationUsableInChat } from "@toby/core/chat-integrations";
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

const repoRoot = path.resolve(import.meta.dirname, "..");
const sampleCli = path.join(repoRoot, "../plugin-sample/src/cli.ts");

function writeSamplePluginWrapper(pluginDir: string): string {
	fs.mkdirSync(pluginDir, { recursive: true });
	const wrapperPath = path.join(pluginDir, "toby-plugin-sample");
	const script = `#!/usr/bin/env bash\nexec bun ${JSON.stringify(sampleCli)} "$@"\n`;
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
