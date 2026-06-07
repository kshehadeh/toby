import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	getConfigPath,
	getPluginsDir,
	readCredentials,
} from "@toby/core/config/index";
import {
	getIntegrationModule,
	isBuiltinIntegration,
} from "@toby/core/integrations/index";
import { discoverPluginBinaries } from "@toby/core/integrations/plugins/discovery";
import {
	PluginInstallException,
	installPlugin,
	resolvePluginInstallTarget,
	resolvePluginSourcePath,
	uninstallPlugin,
	validatePluginForInstall,
} from "@toby/core/integrations/plugins/install";
import { parsePluginNameFromBinary } from "@toby/core/integrations/plugins/protocol";
import {
	getPluginModules,
	resetPluginModuleCache,
} from "@toby/core/integrations/plugins/registry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sampleCli = path.join(repoRoot, "../plugin-sample/src/cli.ts");

function writeSamplePluginWrapper(targetPath: string): string {
	fs.mkdirSync(path.dirname(targetPath), { recursive: true });
	const script = `#!/usr/bin/env bash\nexec bun ${JSON.stringify(sampleCli)} "$@"\n`;
	fs.writeFileSync(targetPath, script, { mode: 0o755 });
	return targetPath;
}

function writeFakeGmailPlugin(targetPath: string): string {
	fs.mkdirSync(path.dirname(targetPath), { recursive: true });
	const script = `#!/usr/bin/env bash
case "$1" in
  status)
    echo '{"ok":true,"name":"gmail","displayName":"Fake Gmail","description":"collision test","version":"0.0.1","protocolVersion":"1","connected":false,"capabilities":[]}'
    ;;
  tools)
    if [[ "$2" == "list" ]]; then
      echo '{"ok":true,"tools":[]}'
    fi
    ;;
esac
`;
	fs.writeFileSync(targetPath, script, { mode: 0o755 });
	return targetPath;
}

function writeFakeTodoistPlugin(targetPath: string): string {
	fs.mkdirSync(path.dirname(targetPath), { recursive: true });
	const script = `#!/usr/bin/env bash
case "$1" in
  status)
    echo '{"ok":true,"name":"todoist","displayName":"Fake Todoist","description":"collision test","version":"0.0.1","protocolVersion":"1","connected":false,"capabilities":[]}'
    ;;
  tools)
    if [[ "$2" == "list" ]]; then
      echo '{"ok":true,"tools":[]}'
    fi
    ;;
esac
`;
	fs.writeFileSync(targetPath, script, { mode: 0o755 });
	return targetPath;
}

describe("plugin install", () => {
	let tempDir: string;
	let sourceDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-plugin-install-"));
		sourceDir = path.join(tempDir, "source");
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = path.join(tempDir, "toby-home");
		resetPluginModuleCache();
		fs.mkdirSync(sourceDir, { recursive: true });
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

	it("installs a valid plugin binary into TOBY_DIR/plugins", () => {
		const sourcePath = writeSamplePluginWrapper(
			path.join(sourceDir, "toby-plugin-sample"),
		);

		const result = installPlugin(sourcePath);
		expect(result.name).toBe("sample");
		expect(result.displayName).toBe("Sample Plugin");
		expect(result.installPath).toBe(resolvePluginInstallTarget("sample"));
		expect(fs.existsSync(result.installPath)).toBe(true);
		expect(fs.readFileSync(result.installPath, "utf8")).toContain("exec bun");
		expect(result.setupAvailable).toBe(true);
		expect(result.setupDescription).toContain("Demo setup");
	});

	it("discovers installed plugin from user plugins directory", () => {
		const sourcePath = writeSamplePluginWrapper(
			path.join(sourceDir, "toby-plugin-sample"),
		);
		installPlugin(sourcePath);

		const discovered = discoverPluginBinaries();
		expect(
			discovered.some(
				(p) =>
					p.binaryName === "toby-plugin-sample" &&
					p.binaryPath === resolvePluginInstallTarget("sample"),
			),
		).toBe(true);
	});

	it("registers installed plugin modules after cache reset", () => {
		const sourcePath = writeSamplePluginWrapper(
			path.join(sourceDir, "toby-plugin-sample"),
		);
		installPlugin(sourcePath);

		const sample = getIntegrationModule("sample");
		expect(sample).toBeDefined();
		expect(getPluginModules().some((m) => m.name === "sample")).toBe(true);
	});

	it("rejects invalid binary names", () => {
		const badPath = path.join(sourceDir, "my-plugin");
		writeSamplePluginWrapper(badPath);

		expect(() => resolvePluginSourcePath(badPath)).toThrow(
			PluginInstallException,
		);
	});

	it("rejects non-executable binaries", () => {
		const sourcePath = path.join(sourceDir, "toby-plugin-sample");
		fs.writeFileSync(sourcePath, "#!/usr/bin/env bash\nexit 0\n", {
			mode: 0o644,
		});

		const discovered = resolvePluginSourcePath(sourcePath);
		const result = validatePluginForInstall(discovered);
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.code).toBe("not_executable");
		}
	});

	it("allows azuread plugin install now that built-in module was removed", () => {
		expect(isBuiltinIntegration("azuread")).toBe(false);
	});

	it("allows gmail plugin install now that built-in module was removed", () => {
		expect(isBuiltinIntegration("gmail")).toBe(false);

		const sourcePath = writeFakeGmailPlugin(
			path.join(sourceDir, "toby-plugin-gmail"),
		);
		const discovered = resolvePluginSourcePath(sourcePath);
		const result = validatePluginForInstall(discovered);
		expect("error" in result).toBe(false);
	});

	it("rejects built-in integration name collisions", () => {
		expect(isBuiltinIntegration("todoist")).toBe(true);

		const sourcePath = writeFakeTodoistPlugin(
			path.join(sourceDir, "toby-plugin-todoist"),
		);
		const discovered = resolvePluginSourcePath(sourcePath);
		const result = validatePluginForInstall(discovered);
		expect("error" in result).toBe(true);
		if ("error" in result) {
			expect(result.code).toBe("builtin_collision");
		}
	});

	it("requires --force to overwrite an existing install", () => {
		const sourcePath = writeSamplePluginWrapper(
			path.join(sourceDir, "toby-plugin-sample"),
		);
		installPlugin(sourcePath);

		expect(() => installPlugin(sourcePath)).toThrow(PluginInstallException);
		expect(() => installPlugin(sourcePath, { force: true })).not.toThrow();
	});

	it("supports --link to install a symlink", () => {
		const sourcePath = writeSamplePluginWrapper(
			path.join(sourceDir, "toby-plugin-sample"),
		);
		const result = installPlugin(sourcePath, { link: true });

		expect(result.linked).toBe(true);
		const linkStat = fs.lstatSync(result.installPath);
		expect(linkStat.isSymbolicLink()).toBe(true);
		expect(fs.readlinkSync(result.installPath)).toBe(path.resolve(sourcePath));

		resetPluginModuleCache();
		const discovered = discoverPluginBinaries();
		expect(discovered.some((p) => p.binaryName === "toby-plugin-sample")).toBe(
			true,
		);
		expect(getIntegrationModule("sample")).toBeDefined();
	});

	it("resolves a directory containing exactly one plugin binary", () => {
		const sourcePath = writeSamplePluginWrapper(
			path.join(sourceDir, "toby-plugin-sample"),
		);
		const discovered = resolvePluginSourcePath(sourceDir);
		expect(discovered.binaryPath).toBe(sourcePath);
		expect(parsePluginNameFromBinary(discovered.binaryName)).toBe("sample");
	});

	it("uninstall removes the managed plugin copy and purges stored artifacts", () => {
		const sourcePath = writeSamplePluginWrapper(
			path.join(sourceDir, "toby-plugin-sample"),
		);
		const installed = installPlugin(sourcePath);
		expect(fs.existsSync(installed.installPath)).toBe(true);

		const configPath = getConfigPath();
		fs.mkdirSync(path.dirname(configPath), { recursive: true });
		fs.writeFileSync(
			configPath,
			JSON.stringify(
				{
					integrations: {
						sample: { connectedAt: "2026-05-31T12:00:00.000Z" },
					},
					personas: [],
					defaultProviders: { search: "sample" },
					chatInbound: { enabled: true, integration: "sample" },
					plugins: { disabled: ["sample"] },
				},
				null,
				2,
			),
		);
		fs.writeFileSync(
			path.join(process.env.TOBY_DIR as string, "credentials.json"),
			JSON.stringify(
				{ integrations: { sample: { apiKey: "secret" } } },
				null,
				2,
			),
		);

		const removed = uninstallPlugin("sample");
		expect(removed.removedPath).toBe(installed.installPath);
		expect(fs.existsSync(installed.installPath)).toBe(false);
		expect(fs.existsSync(sourcePath)).toBe(true);
		expect(readCredentials().integrations?.sample).toBeUndefined();

		const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
			integrations?: Record<string, unknown>;
			defaultProviders?: Record<string, string>;
			chatInbound?: { integration?: string };
			plugins?: { disabled?: string[] };
		};
		expect(config.integrations?.sample).toBeUndefined();
		expect(config.defaultProviders?.search).toBeUndefined();
		expect(config.chatInbound?.integration).toBeUndefined();
		expect(config.plugins?.disabled).toEqual([]);
		expect(removed.purged.credentials).toBe(true);
		expect(removed.purged.connectionState).toBe(true);
		expect(removed.purged.disabledEntry).toBe(true);
		expect(removed.purged.defaultProviderReferences).toBe(1);
		expect(removed.purged.chatInboundReference).toBe(true);
	});

	it("getPluginsDir matches install target parent directory", () => {
		expect(getPluginsDir()).toBe(
			path.join(process.env.TOBY_DIR as string, "plugins"),
		);
	});
});
