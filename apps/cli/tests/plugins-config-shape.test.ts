import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCredentialsFromValues } from "@toby/core/configure/persistence";
import {
	createPluginIntegrationModule,
	loadPluginMetadata,
} from "@toby/core/integrations/plugins/adapter";
import { pluginConfigShape } from "@toby/core/integrations/plugins/client";
import {
	findPrefixedPluginConfigFieldKeys,
	validatePluginBinary,
	validatePluginConfigShapeFields,
} from "@toby/core/integrations/plugins/validate";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sampleCli = path.join(repoRoot, "../plugin-sample/src/cli.ts");

function installSamplePlugin(pluginDir: string): string {
	fs.mkdirSync(pluginDir, { recursive: true });
	const wrapperPath = path.join(pluginDir, "toby-plugin-sample");
	const script = `#!/usr/bin/env bash\nexec bun ${JSON.stringify(sampleCli)} "$@"\n`;
	fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
	return wrapperPath;
}

describe("plugin config shape validation", () => {
	it("detects prefixed config shape keys", () => {
		expect(
			findPrefixedPluginConfigFieldKeys("jira", [
				{ key: "domain", label: "Domain", type: "string" },
				{ key: "jira.email", label: "Email", type: "string" },
			]),
		).toEqual(["jira.email"]);
	});

	it("returns a helpful validation error for prefixed keys", () => {
		const message = validatePluginConfigShapeFields("todoist", [
			{ key: "todoist.apiKey", label: "API Key", type: "string" },
		]);
		expect(message).toContain("todoist.apiKey");
		expect(message).toContain("integrations.todoist");
	});

	it("accepts local config shape keys", () => {
		expect(
			validatePluginConfigShapeFields("slack", [
				{ key: "botToken", label: "Bot Token", type: "string" },
			]),
		).toBeUndefined();
	});
});

describe("plugin credential persistence", () => {
	let tempDir: string;
	let pluginDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-plugin-shape-"));
		pluginDir = path.join(tempDir, "toby-home", "plugins");
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = path.join(tempDir, "toby-home");
		installSamplePlugin(pluginDir);
	});

	afterEach(() => {
		if (previousTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("round-trips sample plugin credentials through configure persistence", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-sample");
		const metadata = loadPluginMetadata({
			kind: "binary",
			binaryPath,
			binaryName: "toby-plugin-sample",
		});
		expect("error" in metadata).toBe(false);
		if ("error" in metadata) return;

		const module = createPluginIntegrationModule(metadata);
		const creds = buildCredentialsFromValues(
			{
				"sample.apiKey": "secret",
				"sample.greeting": "Hello",
			},
			{},
		);
		expect(creds.integrations?.sample).toEqual({
			apiKey: "secret",
			greeting: "Hello",
		});

		const seeded = module.seedCredentialValues(creds);
		expect(seeded["sample.apiKey"]).toBe("secret");
		expect(seeded["sample.greeting"]).toBe("Hello");
	});

	it("validatePluginBinary rejects prefixed config shape keys", () => {
		const binaryPath = path.join(pluginDir, "toby-plugin-sample");
		const shape = pluginConfigShape(binaryPath);
		expect(shape.ok).toBe(true);
		if (!shape.ok || !shape.data.fields) return;
		expect(validatePluginConfigShapeFields("sample", shape.data.fields)).toBe(
			undefined,
		);

		const validated = validatePluginBinary({
			kind: "binary",
			binaryPath,
			binaryName: "toby-plugin-sample",
		});
		expect(validated.ok).toBe(true);
	});
});
