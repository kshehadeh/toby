import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseChatCliInput } from "@toby/core/chat-integrations";
import { resetPluginModuleCache } from "@toby/core/integrations/plugins/registry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");
const azureadCli = path.join(repoRoot, "../plugin-azuread/src/cli.ts");
const gmailCli = path.join(repoRoot, "../plugin-gmail/src/cli.ts");
const todoistCli = path.join(repoRoot, "../plugin-todoist/src/cli.ts");
const macosPluginPackageDir = path.join(repoRoot, "../plugin-macos");

function writePluginWrapper(
	pluginDir: string,
	binaryName: string,
	cliPath: string,
): void {
	fs.mkdirSync(pluginDir, { recursive: true });
	const wrapperPath = path.join(pluginDir, binaryName);
	const script = `#!/usr/bin/env bash\nexec bun ${JSON.stringify(cliPath)} "$@"\n`;
	fs.writeFileSync(wrapperPath, script, { mode: 0o755 });
}

function resolveBuiltMacOSPluginBinary(): string {
	const distBin = path.join(repoRoot, "../../dist/toby-plugin-macos");
	const releaseBin = path.join(
		macosPluginPackageDir,
		".build/release/toby-plugin-macos",
	);
	if (fs.existsSync(distBin)) return distBin;
	if (fs.existsSync(releaseBin)) return releaseBin;
	execSync("swift build -c release", {
		cwd: macosPluginPackageDir,
		stdio: "pipe",
	});
	return releaseBin;
}

function installMacOSPlugin(pluginDir: string): void {
	fs.mkdirSync(pluginDir, { recursive: true });
	const source = resolveBuiltMacOSPluginBinary();
	const dest = path.join(pluginDir, "toby-plugin-macos");
	fs.copyFileSync(source, dest);
	fs.chmodSync(dest, 0o755);
}

describe("parseChatCliInput", () => {
	let tempDir: string;
	let previousTobyDir: string | undefined;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-chat-int-"));
		previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = path.join(tempDir, "toby-home");
		resetPluginModuleCache();
		const pluginsDir = path.join(tempDir, "toby-home", "plugins");
		writePluginWrapper(pluginsDir, "toby-plugin-azuread", azureadCli);
		writePluginWrapper(pluginsDir, "toby-plugin-gmail", gmailCli);
		writePluginWrapper(pluginsDir, "toby-plugin-todoist", todoistCli);
		installMacOSPlugin(pluginsDir);
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

	it("defaults to all connected when no flags and no words", () => {
		expect(parseChatCliInput([], [])).toEqual({
			explicitNames: null,
			prompt: "",
		});
	});

	it("uses all connected when first word is not an integration", () => {
		expect(parseChatCliInput(["hello", "world"], [])).toEqual({
			explicitNames: null,
			prompt: "hello world",
		});
	});

	it("peels gmail as integration and rest as prompt", () => {
		expect(parseChatCliInput(["gmail", "archive", "spam"], [])).toEqual({
			explicitNames: ["gmail"],
			prompt: "archive spam",
		});
	});

	it("peels todoist as integration", () => {
		expect(parseChatCliInput(["todoist"], [])).toEqual({
			explicitNames: ["todoist"],
			prompt: "",
		});
	});

	it("peels azuread as integration", () => {
		expect(parseChatCliInput(["azuread", "find", "alice"], [])).toEqual({
			explicitNames: ["azuread"],
			prompt: "find alice",
		});
	});

	it("peels macos as integration", () => {
		expect(parseChatCliInput(["macos", "wifi", "off"], [])).toEqual({
			explicitNames: ["macos"],
			prompt: "wifi off",
		});
	});

	it("treats all positional as prompt when flags set", () => {
		expect(parseChatCliInput(["gmail", "hello"], ["todoist", "gmail"])).toEqual(
			{
				explicitNames: ["todoist", "gmail"],
				prompt: "gmail hello",
			},
		);
	});

	it("dedupes integration flags case-insensitively", () => {
		expect(parseChatCliInput([], ["Gmail", "gmail", "todoist"])).toEqual({
			explicitNames: ["gmail", "todoist"],
			prompt: "",
		});
	});
});
