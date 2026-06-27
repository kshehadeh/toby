import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	pluginConfigShape,
	pluginStatus,
	pluginToolsList,
} from "@toby/core/integrations/plugins/client";
import { discoverPluginBinaries } from "@toby/core/integrations/plugins/discovery";
import {
	installPlugin,
	uninstallPlugin,
} from "@toby/core/integrations/plugins/install";
import { pluginDisplayPath } from "@toby/core/integrations/plugins/protocol";
import {
	getPluginModules,
	resetPluginModuleCache,
} from "@toby/core/integrations/plugins/registry";
import { resolvePluginTarget } from "@toby/core/integrations/plugins/runtime";
import { validatePluginBinary } from "@toby/core/integrations/plugins/validate";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

/**
 * Minimal TypeScript plugin entry point that implements protocol v1.
 * Written as a string and saved to a temp directory for testing.
 */
const pluginEntryTs = `#!/usr/bin/env bun

type JsonRecord = Record<string, unknown>;

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    if (process.stdin.isTTY) resolve("");
  });
}

function parseEnvelope(raw: string): { config: JsonRecord; state: JsonRecord } {
  if (!raw.trim()) return { config: {}, state: {} };
  try {
    const parsed = JSON.parse(raw) as JsonRecord;
    return {
      config: (parsed.config as JsonRecord) ?? {},
      state: (parsed.state as JsonRecord) ?? {},
    };
  } catch {
    process.stdout.write(JSON.stringify({ ok: false, error: "Invalid JSON", code: "invalid_input" }) + "\\n");
    process.exit(2);
  }
}

function emitJson(payload: JsonRecord, exitCode = 0): never {
  process.stdout.write(JSON.stringify(payload) + "\\n");
  process.exit(exitCode);
}

async function main() {
  const [cmd, sub] = [process.argv[2], process.argv[3]];

  if (cmd === "status") {
    const raw = await readStdin();
    const { config } = parseEnvelope(raw);
    const connected = Boolean(config.apiKey);
    emitJson({
      ok: true,
      name: "testpkg",
      displayName: "Test Package Plugin",
      description: "TypeScript bun-package test plugin",
      version: "1.0.0",
      protocolVersion: "1",
      connected,
      capabilities: ["chat"],
      chatModelPrep: {
        systemPromptSection: "### Test Package\\nTest bun-package plugin.",
        singleSessionRules: "Use the testSearch tool to search.",
        multiUserContentTemplate: "User request: {{userPrompt}}",
      },
    });
  }

  if (cmd === "connect") {
    const raw = await readStdin();
    const { config } = parseEnvelope(raw);
    if (!config.apiKey) {
      emitJson({ ok: false, reason: "apiKey is required" });
    }
    emitJson({ ok: true, reason: "Connected." });
  }

  if (cmd === "disconnect") {
    emitJson({ ok: true, reason: "Disconnected." });
  }

  if (cmd === "config" && sub === "shape") {
    emitJson({
      ok: true,
      fields: [
        { key: "apiKey", label: "API Key", type: "string", required: true, masked: true },
      ],
    });
  }

  if (cmd === "config" && sub === "get") {
    const raw = await readStdin();
    const { config } = parseEnvelope(raw);
    emitJson({ ok: true, config });
  }

  if (cmd === "config" && sub === "set") {
    emitJson({ ok: true });
  }

  if (cmd === "tools" && sub === "list") {
    emitJson({
      ok: true,
      tools: [
        {
          name: "testSearch",
          description: "Search for test results",
          readOnly: true,
          inputSchema: {
            type: "object",
            properties: { query: { type: "string", description: "Search query" } },
            required: ["query"],
          },
        },
      ],
    });
  }

  if (cmd === "tools" && sub === "execute") {
    const raw = await readStdin();
    const parsed = JSON.parse(raw) as JsonRecord;
    emitJson({ ok: true, result: { results: ["test result for " + (parsed.input as JsonRecord)?.query] } });
  }

  emitJson({ ok: false, error: "Unknown command", code: "unknown_command" }, 2);
}

main();
`;

const validManifest = {
	name: "testpkg",
	displayName: "Test Package Plugin",
	description: "TypeScript bun-package test plugin",
	version: "1.0.0",
	protocolVersion: "1",
	runtime: { type: "bun", entry: "src/index.ts" },
	capabilities: ["chat"],
};

function createBunPackagePlugin(parentDir: string): string {
	const pluginDir = path.join(parentDir, "toby-plugin-testpkg");
	fs.mkdirSync(pluginDir, { recursive: true });
	fs.writeFileSync(
		path.join(pluginDir, "manifest.json"),
		JSON.stringify(validManifest, null, 2),
	);
	fs.mkdirSync(path.join(pluginDir, "src"), { recursive: true });
	fs.writeFileSync(path.join(pluginDir, "src", "index.ts"), pluginEntryTs);
	fs.writeFileSync(
		path.join(pluginDir, "package.json"),
		JSON.stringify({ name: "toby-plugin-testpkg", version: "1.0.0" }, null, 2),
	);
	return pluginDir;
}

describe("bun-package plugin", () => {
	let tempDir: string;
	let tobyHome: string;
	let pluginDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-bunpkg-test-"));
		tobyHome = path.join(tempDir, "toby-home");
		pluginDir = path.join(tobyHome, "plugins");
		fs.mkdirSync(pluginDir, { recursive: true });
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = tobyHome;
		resetPluginModuleCache();
	});

	afterEach(() => {
		if (previousTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		resetPluginModuleCache();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("discovers a directory plugin with manifest.json", () => {
		createBunPackagePlugin(pluginDir);
		const discovered = discoverPluginBinaries();
		const found = discovered.find(
			(d) => d.binaryName === "toby-plugin-testpkg",
		);
		expect(found).toBeDefined();
		expect(found?.kind).toBe("bun-package");
	});

	it("runs status through bun transport", () => {
		createBunPackagePlugin(pluginDir);
		const discovered = discoverPluginBinaries();
		const found = discovered.find(
			(d) => d.binaryName === "toby-plugin-testpkg",
		);
		expect(found).toBeDefined();
		if (!found) return;

		const target = resolvePluginTarget(found);
		const result = pluginStatus(target);
		expect(result.ok).toBe(true);
		expect(result.data.ok).toBe(true);
		expect(result.data.name).toBe("testpkg");
		expect(result.data.protocolVersion).toBe("1");
	});

	it("runs tools list through bun transport", () => {
		createBunPackagePlugin(pluginDir);
		const discovered = discoverPluginBinaries();
		const found = discovered.find(
			(d) => d.binaryName === "toby-plugin-testpkg",
		);
		if (!found) return;

		const target = resolvePluginTarget(found);
		const result = pluginToolsList(target);
		expect(result.ok).toBe(true);
		expect(result.data.ok).toBe(true);
		expect(result.data.tools?.length).toBe(1);
		expect(result.data.tools?.[0].name).toBe("testSearch");
	});

	it("runs config shape through bun transport", () => {
		createBunPackagePlugin(pluginDir);
		const discovered = discoverPluginBinaries();
		const found = discovered.find(
			(d) => d.binaryName === "toby-plugin-testpkg",
		);
		if (!found) return;

		const target = resolvePluginTarget(found);
		const result = pluginConfigShape(target);
		expect(result.ok).toBe(true);
		expect(result.data.ok).toBe(true);
		expect(result.data.fields?.[0].key).toBe("apiKey");
	});

	it("validates a bun-package plugin with doctor", () => {
		createBunPackagePlugin(pluginDir);
		const discovered = discoverPluginBinaries();
		const found = discovered.find(
			(d) => d.binaryName === "toby-plugin-testpkg",
		);
		if (!found) return;

		const result = validatePluginBinary(found);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.metadata.name).toBe("testpkg");
	});

	it("registers a bun-package plugin as an integration module", () => {
		createBunPackagePlugin(pluginDir);
		const modules = getPluginModules();
		const found = modules.find((m) => m.name === "testpkg");
		expect(found).toBeDefined();
		expect(found?.displayName).toBe("Test Package Plugin");
	});

	it("installs a directory plugin by copying", () => {
		const sourceDir = path.join(tempDir, "source");
		const sourcePluginDir = createBunPackagePlugin(sourceDir);

		const result = installPlugin(sourcePluginDir);
		expect(result.name).toBe("testpkg");
		expect(result.linked).toBe(false);

		const installedPath = path.join(pluginDir, "toby-plugin-testpkg");
		expect(fs.existsSync(installedPath)).toBe(true);
		expect(fs.statSync(installedPath).isDirectory()).toBe(true);
		expect(fs.existsSync(path.join(installedPath, "manifest.json"))).toBe(true);
	});

	it("installs a directory plugin with --link", () => {
		const sourceDir = path.join(tempDir, "source");
		const sourcePluginDir = createBunPackagePlugin(sourceDir);

		const result = installPlugin(sourcePluginDir, { link: true });
		expect(result.name).toBe("testpkg");
		expect(result.linked).toBe(true);

		const installedPath = path.join(pluginDir, "toby-plugin-testpkg");
		expect(fs.lstatSync(installedPath).isSymbolicLink()).toBe(true);
	});

	it("uninstalls a directory plugin", () => {
		const sourceDir = path.join(tempDir, "source");
		const sourcePluginDir = createBunPackagePlugin(sourceDir);

		installPlugin(sourcePluginDir);
		const installedPath = path.join(pluginDir, "toby-plugin-testpkg");
		expect(fs.existsSync(installedPath)).toBe(true);

		uninstallPlugin("testpkg");
		expect(fs.existsSync(installedPath)).toBe(false);
	});

	it("pluginDisplayPath returns directory path for bun-package plugins", () => {
		createBunPackagePlugin(pluginDir);
		const discovered = discoverPluginBinaries();
		const found = discovered.find(
			(d) => d.binaryName === "toby-plugin-testpkg",
		);
		if (!found) return;

		expect(pluginDisplayPath(found)).toBe(
			path.join(pluginDir, "toby-plugin-testpkg"),
		);
	});
});
