import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolvePluginIconAssetPath } from "@toby/core/integrations/plugins/icons";
import {
	parseManifest,
	validateManifest,
} from "@toby/core/integrations/plugins/manifest";

const validManifest = {
	name: "testpkg",
	displayName: "Test Package",
	description: "Test bun-package plugin",
	version: "1.0.0",
	protocolVersion: "1",
	runtime: { type: "bun", entry: "src/index.ts" },
	capabilities: ["chat"],
};

function writeManifest(dir: string, manifest: unknown): void {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "manifest.json"),
		JSON.stringify(manifest, null, 2),
	);
}

function writeEntryFile(dir: string, entryPath = "src/index.ts"): void {
	const fullPath = path.join(dir, entryPath);
	fs.mkdirSync(path.dirname(fullPath), { recursive: true });
	fs.writeFileSync(fullPath, 'console.log("hello");\n');
}

describe("manifest parsing", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-manifest-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("parses a valid manifest", () => {
		const pluginDir = path.join(tempDir, "toby-plugin-testpkg");
		writeManifest(pluginDir, validManifest);
		writeEntryFile(pluginDir);

		const result = parseManifest(pluginDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.manifest.name).toBe("testpkg");
		expect(result.manifest.runtime.type).toBe("bun");
		expect(result.manifest.runtime.entry).toBe("src/index.ts");
	});

	it("parses an optional icon asset", () => {
		const pluginDir = path.join(tempDir, "toby-plugin-testpkg");
		writeManifest(pluginDir, {
			...validManifest,
			icon: "📅",
			iconAsset: { path: "assets/icon-256.png", mimeType: "image/png" },
		});
		writeEntryFile(pluginDir);

		const result = parseManifest(pluginDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.manifest.icon).toBe("📅");
		expect(result.manifest.iconAsset).toEqual({
			path: "assets/icon-256.png",
			mimeType: "image/png",
		});
	});

	it("fails when icon asset mime type is unsupported", () => {
		const pluginDir = path.join(tempDir, "toby-plugin-testpkg");
		writeManifest(pluginDir, {
			...validManifest,
			iconAsset: { path: "assets/icon.svg", mimeType: "image/svg+xml" },
		});
		writeEntryFile(pluginDir);

		const result = parseManifest(pluginDir);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("manifest_invalid_icon_asset_mime_type");
	});

	it("fails when manifest.json is missing", () => {
		const pluginDir = path.join(tempDir, "toby-plugin-testpkg");
		fs.mkdirSync(pluginDir, { recursive: true });

		const result = parseManifest(pluginDir);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("manifest_not_found");
	});

	it("fails on invalid JSON", () => {
		const pluginDir = path.join(tempDir, "toby-plugin-testpkg");
		fs.mkdirSync(pluginDir, { recursive: true });
		fs.writeFileSync(path.join(pluginDir, "manifest.json"), "{ not json }");

		const result = parseManifest(pluginDir);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("manifest_invalid_json");
	});

	it("fails when name is missing", () => {
		const pluginDir = path.join(tempDir, "toby-plugin-testpkg");
		writeManifest(pluginDir, { ...validManifest, name: undefined });
		writeEntryFile(pluginDir);

		const result = parseManifest(pluginDir);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("manifest_missing_name");
	});

	it("fails when runtime type is not bun", () => {
		const pluginDir = path.join(tempDir, "toby-plugin-testpkg");
		writeManifest(pluginDir, {
			...validManifest,
			runtime: { type: "node", entry: "src/index.ts" },
		});
		writeEntryFile(pluginDir);

		const result = parseManifest(pluginDir);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("manifest_unsupported_runtime");
	});

	it("fails when entry is missing", () => {
		const pluginDir = path.join(tempDir, "toby-plugin-testpkg");
		writeManifest(pluginDir, {
			...validManifest,
			runtime: { type: "bun" },
		});

		const result = parseManifest(pluginDir);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("manifest_missing_entry");
	});
});

describe("manifest validation", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-manifest-val-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("validates a correct manifest", () => {
		const pluginDir = path.join(tempDir, "toby-plugin-testpkg");
		writeManifest(pluginDir, validManifest);
		writeEntryFile(pluginDir);

		const parseResult = parseManifest(pluginDir);
		expect(parseResult.ok).toBe(true);
		if (!parseResult.ok) return;

		const result = validateManifest(
			parseResult.manifest,
			pluginDir,
			"toby-plugin-testpkg",
		);
		expect(result.ok).toBe(true);
	});

	it("fails when name does not match directory", () => {
		const pluginDir = path.join(tempDir, "toby-plugin-testpkg");
		writeManifest(pluginDir, { ...validManifest, name: "wrongname" });
		writeEntryFile(pluginDir);

		const parseResult = parseManifest(pluginDir);
		expect(parseResult.ok).toBe(true);
		if (!parseResult.ok) return;

		const result = validateManifest(
			parseResult.manifest,
			pluginDir,
			"toby-plugin-testpkg",
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("name_mismatch");
	});

	it("fails when protocol version is unsupported", () => {
		const pluginDir = path.join(tempDir, "toby-plugin-testpkg");
		writeManifest(pluginDir, { ...validManifest, protocolVersion: "99" });
		writeEntryFile(pluginDir);

		const parseResult = parseManifest(pluginDir);
		expect(parseResult.ok).toBe(true);
		if (!parseResult.ok) return;

		const result = validateManifest(
			parseResult.manifest,
			pluginDir,
			"toby-plugin-testpkg",
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("unsupported_protocol");
	});

	it("fails when entry file does not exist", () => {
		const pluginDir = path.join(tempDir, "toby-plugin-testpkg");
		writeManifest(pluginDir, validManifest);
		// Don't write the entry file

		const parseResult = parseManifest(pluginDir);
		expect(parseResult.ok).toBe(true);
		if (!parseResult.ok) return;

		const result = validateManifest(
			parseResult.manifest,
			pluginDir,
			"toby-plugin-testpkg",
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("entry_not_found");
	});
});

describe("plugin icon asset paths", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-icon-path-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("rejects absolute and traversal icon paths", () => {
		const target = {
			kind: "bun-package" as const,
			bunPath: "bun",
			cwd: tempDir,
			entryPath: "src/index.ts",
		};

		expect(
			resolvePluginIconAssetPath(target, { path: "../icon.png" }),
		).toBeNull();
		expect(
			resolvePluginIconAssetPath(target, { path: "/tmp/icon.png" }),
		).toBeNull();
		expect(
			resolvePluginIconAssetPath(target, { path: "assets/icon.png" }),
		).toBe(path.join(tempDir, "assets", "icon.png"));
	});
});

describe("manifest events.poll parsing", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-manifest-events-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("parses events.poll.intervalSeconds", () => {
		const pluginDir = path.join(tempDir, "toby-plugin-testpkg");
		writeManifest(pluginDir, {
			...validManifest,
			events: { poll: { intervalSeconds: 120 } },
		});
		writeEntryFile(pluginDir);

		const result = parseManifest(pluginDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.manifest.events?.poll?.intervalSeconds).toBe(120);
	});

	it("returns undefined events when not present", () => {
		const pluginDir = path.join(tempDir, "toby-plugin-testpkg");
		writeManifest(pluginDir, validManifest);
		writeEntryFile(pluginDir);

		const result = parseManifest(pluginDir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.manifest.events).toBeUndefined();
	});

	it("fails when events.poll.intervalSeconds is not a number", () => {
		const pluginDir = path.join(tempDir, "toby-plugin-testpkg");
		writeManifest(pluginDir, {
			...validManifest,
			events: { poll: { intervalSeconds: "300" } },
		});
		writeEntryFile(pluginDir);

		const result = parseManifest(pluginDir);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("manifest_invalid_poll_interval");
	});

	it("fails when events.poll.intervalSeconds is less than 1", () => {
		const pluginDir = path.join(tempDir, "toby-plugin-testpkg");
		writeManifest(pluginDir, {
			...validManifest,
			events: { poll: { intervalSeconds: 0 } },
		});
		writeEntryFile(pluginDir);

		const result = parseManifest(pluginDir);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("manifest_invalid_poll_interval");
	});

	it("fails when events is not an object", () => {
		const pluginDir = path.join(tempDir, "toby-plugin-testpkg");
		writeManifest(pluginDir, {
			...validManifest,
			events: "invalid",
		});
		writeEntryFile(pluginDir);

		const result = parseManifest(pluginDir);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe("manifest_invalid_events");
	});
});

describe("plugin discovery kind + target recovery", () => {
	let tempDir: string;
	let previousPluginsDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-plugin-kind-"));
		previousPluginsDir = process.env.TOBY_PLUGINS_DIR;
		process.env.TOBY_PLUGINS_DIR = tempDir;
	});

	afterEach(() => {
		if (previousPluginsDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_PLUGINS_DIR");
		} else {
			process.env.TOBY_PLUGINS_DIR = previousPluginsDir;
		}
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("discovers a directory with manifest.json as bun-package (not binary)", async () => {
		const { discoverPluginBinaries } = await import(
			"@toby/core/integrations/plugins/discovery"
		);
		const pluginDir = path.join(tempDir, "toby-plugin-testpkg");
		writeManifest(pluginDir, validManifest);
		writeEntryFile(pluginDir);

		const discovered = discoverPluginBinaries();
		const hit = discovered.find((p) => p.binaryName === "toby-plugin-testpkg");
		expect(hit?.kind).toBe("bun-package");
		if (hit?.kind !== "bun-package") return;
		expect(hit.directoryPath).toBe(pluginDir);
	});

	it("upgrades a stale binary descriptor when the path is a bun-package directory", async () => {
		const { resolvePluginTarget } = await import(
			"@toby/core/integrations/plugins/runtime"
		);
		const pluginDir = path.join(tempDir, "toby-plugin-testpkg");
		writeManifest(pluginDir, validManifest);
		writeEntryFile(pluginDir);

		const target = resolvePluginTarget({
			kind: "binary",
			binaryName: "toby-plugin-testpkg",
			binaryPath: pluginDir,
		});
		expect(target.kind).toBe("bun-package");
		if (target.kind !== "bun-package") return;
		expect(target.cwd).toBe(pluginDir);
		expect(target.entryPath).toBe(path.join(pluginDir, "src/index.ts"));
	});
});
