import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseChatCliInput } from "@toby/core/chat-integrations";
import { resetPluginModuleCache } from "@toby/core/integrations/plugins/registry";

const repoRoot = path.resolve(import.meta.dirname, "..");
const slackCli = path.join(repoRoot, "../plugin-slack/src/cli.ts");
const todoistPluginDir = path.join(repoRoot, "../plugin-todoist");
const macosPluginSourceDir = path.join(repoRoot, "../plugin-macos");

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

function copyTodoistPluginDir(pluginDir: string): void {
	fs.mkdirSync(pluginDir, { recursive: true });
	const dest = path.join(pluginDir, "toby-plugin-todoist");
	fs.cpSync(todoistPluginDir, dest, {
		recursive: true,
		filter: (src) => !src.includes(".turbo") && !src.includes(".build"),
	});
}

function copyMacOSPluginDir(pluginDir: string): void {
	fs.mkdirSync(pluginDir, { recursive: true });
	const dest = path.join(pluginDir, "toby-plugin-macos");
	fs.cpSync(macosPluginSourceDir, dest, {
		recursive: true,
		filter: (src) =>
			!src.includes(".turbo") &&
			!src.includes(".build") &&
			!src.includes("node_modules"),
	});
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
		writePluginWrapper(pluginsDir, "toby-plugin-slack", slackCli);
		copyTodoistPluginDir(pluginsDir);
		copyMacOSPluginDir(pluginsDir);
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

	it("peels slack as integration and rest as prompt", () => {
		expect(parseChatCliInput(["slack", "archive", "spam"], [])).toEqual({
			explicitNames: ["slack"],
			prompt: "archive spam",
		});
	});

	it("peels todoist as integration", () => {
		expect(parseChatCliInput(["todoist"], [])).toEqual({
			explicitNames: ["todoist"],
			prompt: "",
		});
	});

	it("peels macos as integration", () => {
		expect(parseChatCliInput(["macos", "wifi", "off"], [])).toEqual({
			explicitNames: ["macos"],
			prompt: "wifi off",
		});
	});

	it("treats all positional as prompt when flags set", () => {
		expect(parseChatCliInput(["slack", "hello"], ["todoist", "slack"])).toEqual(
			{
				explicitNames: ["todoist", "slack"],
				prompt: "slack hello",
			},
		);
	});

	it("dedupes integration flags case-insensitively", () => {
		expect(parseChatCliInput([], ["Slack", "slack", "todoist"])).toEqual({
			explicitNames: ["slack", "todoist"],
			prompt: "",
		});
	});
});
