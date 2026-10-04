import { expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	readCredentials,
	writeConfig,
	writeCredentials,
} from "@toby/core/config/index";
import {
	createPluginIntegrationModule,
	loadPluginMetadata,
} from "@toby/core/integrations/plugins/adapter";

it("serializes health checks and saves rotated tokens before reporting probe failure", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-status-refresh-"));
	const oldDir = process.env.TOBY_DIR;
	const oldBackend = process.env.TOBY_CREDENTIALS_KEY_BACKEND;
	process.env.TOBY_DIR = dir;
	process.env.TOBY_CREDENTIALS_KEY_BACKEND = "memory";
	try {
		const entry = path.join(dir, "plugin.ts");
		const count = path.join(dir, "refreshes.txt");
		fs.writeFileSync(
			entry,
			`
if (process.argv[2] === "tools" && process.argv[3] === "list") {
 console.log(JSON.stringify({ ok: true, tools: [{ name: "probe", description: "Probe", inputSchema: { type: "object", properties: {} } }] }));
 process.exit(0);
}
const input = JSON.parse(await new Response(Bun.stdin.stream()).text() || "{}");
if (process.argv[2] === "tools") {
 console.log(JSON.stringify({ ok: false, error: "missing_scope", config: { refreshToken: "newer" } }));
 process.exit(0);
}
const payload = { ok: true, name: "refreshfixture", displayName: "Refresh fixture", description: "Fixture", version: "1.0.0", protocolVersion: "1", connected: true, capabilities: [] };
if (input.config?.refreshToken === "old") {
 await Bun.sleep(40);
 await Bun.write(${JSON.stringify(count)}, (await Bun.file(${JSON.stringify(count)}).exists() ? await Bun.file(${JSON.stringify(count)}).text() : "") + "refresh\\n");
 Object.assign(payload, { ok: false, details: "Slack API missing_scope", config: { refreshToken: "new" } });
}
console.log(JSON.stringify(payload));
`,
		);
		const binary = path.join(dir, "toby-plugin-refreshfixture");
		const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
		fs.writeFileSync(
			binary,
			`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(entry)} "$@"\n`,
			{ mode: 0o755 },
		);
		const metadata = loadPluginMetadata({
			kind: "binary",
			binaryPath: binary,
			binaryName: "toby-plugin-refreshfixture",
		});
		if ("error" in metadata) throw new Error(metadata.error);
		writeConfig({
			integrations: { refreshfixture: { connectedAt: "2026-10-04" } },
		});
		writeCredentials({
			integrations: { refreshfixture: { refreshToken: "old" } },
		});
		const module = createPluginIntegrationModule(metadata);
		const [first, second] = await Promise.all([
			module.testConnection(),
			module.testConnection(),
		]);
		expect(first).toMatchObject({
			ok: false,
			details: "Slack API missing_scope",
		});
		expect(second.ok).toBe(true);
		expect(readCredentials().integrations?.refreshfixture?.refreshToken).toBe(
			"new",
		);
		expect(fs.readFileSync(count, "utf8")).toBe("refresh\n");
		const bundle = await module.createChatTools?.({ dryRun: false });
		if (!bundle?.tools.probe.execute) throw new Error("Missing fixture tool");
		const result = await bundle.tools.probe.execute(
			{},
			{ toolCallId: "probe", messages: [] },
		);
		expect(result).toMatchObject({ error: "missing_scope" });
		expect(readCredentials().integrations?.refreshfixture?.refreshToken).toBe(
			"newer",
		);
	} finally {
		if (oldDir === undefined) Reflect.deleteProperty(process.env, "TOBY_DIR");
		else process.env.TOBY_DIR = oldDir;
		if (oldBackend === undefined)
			Reflect.deleteProperty(process.env, "TOBY_CREDENTIALS_KEY_BACKEND");
		else process.env.TOBY_CREDENTIALS_KEY_BACKEND = oldBackend;
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
