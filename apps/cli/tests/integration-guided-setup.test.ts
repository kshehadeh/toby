import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCredentials, writeCredentials } from "@toby/core/config/index";
import {
	handleIntegrationGuidedSetup,
	handleIntegrationSetupCancel,
	handleIntegrationSetupState,
} from "@toby/core/web/handlers/integration-guided-setup";

let dir: string;
let oldDir: string | undefined;
let oldPlugins: string | undefined;
let oldBackend: string | undefined;
beforeEach(() => {
	oldDir = process.env.TOBY_DIR;
	oldPlugins = process.env.TOBY_PLUGINS_DIR;
	oldBackend = process.env.TOBY_CREDENTIALS_KEY_BACKEND;
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-guided-setup-"));
	process.env.TOBY_DIR = dir;
	process.env.TOBY_PLUGINS_DIR = dir;
	process.env.TOBY_CREDENTIALS_KEY_BACKEND = "memory";
	fs.writeFileSync(
		path.join(dir, "toby-plugin-guidedtest"),
		`#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === "config") { console.log(JSON.stringify({ ok: true, fields: [{ key: "botToken", type: "string" }, { key: "clientId", type: "string" }] })); }
else {
 const input = JSON.parse(await new Response(Bun.stdin.stream()).text());
 if (input.config.botToken === "wait") { setInterval(() => {}, 1000); }
 else if (input.config.botToken === "invalid") { console.log(JSON.stringify({ ok: false, error: "Invalid bot token" })); }
 else { console.log(JSON.stringify({ ok: true, config: { botUserId: "U1" }, details: { teamName: "Test workspace" } })); }
}
`,
		{ mode: 0o755 },
	);
	writeCredentials({
		integrations: {
			guidedtest: { botToken: "saved-secret", clientId: "saved-client" },
		},
	});
});
afterEach(() => {
	for (const [key, value] of [
		["TOBY_DIR", oldDir],
		["TOBY_PLUGINS_DIR", oldPlugins],
		["TOBY_CREDENTIALS_KEY_BACKEND", oldBackend],
	]) {
		if (value === undefined) Reflect.deleteProperty(process.env, key as string);
		else process.env[key as string] = value;
	}
	fs.rmSync(dir, { recursive: true, force: true });
});
function request(fields: Record<string, string>) {
	return new Request("http://localhost/setup", {
		method: "POST",
		body: JSON.stringify({ fields, stage: "bot", inbound: false }),
	});
}

describe("integration guided setup", () => {
	it("keeps existing credentials after failed validation", async () => {
		const response = await handleIntegrationGuidedSetup(
			"guidedtest",
			request({ botToken: "invalid" }),
		);
		expect(response.status).toBe(400);
		expect(readCredentials().integrations?.guidedtest?.botToken).toBe(
			"saved-secret",
		);
	});
	it("saves successful drafts without exposing secrets in the response", async () => {
		const response = await handleIntegrationGuidedSetup(
			"guidedtest",
			request({ botToken: "new-secret" }),
		);
		expect(response.status).toBe(200);
		expect(await response.text()).not.toContain("new-secret");
		expect(readCredentials().integrations?.guidedtest?.botToken).toBe(
			"new-secret",
		);
		expect(readCredentials().integrations?.guidedtest?.clientId).toBe(
			"saved-client",
		);
	});
	it("reports configured field names without their values", async () => {
		const state = await handleIntegrationSetupState("guidedtest").text();
		expect(state).toContain("botToken");
		expect(state).not.toContain("saved-secret");
	});
	it("rejects masked placeholders and undeclared fields", async () => {
		expect(
			(
				await handleIntegrationGuidedSetup(
					"guidedtest",
					request({ botToken: "••••••" }),
				)
			).status,
		).toBe(400);
		expect(
			(
				await handleIntegrationGuidedSetup(
					"guidedtest",
					request({ unknown: "value" }),
				)
			).status,
		).toBe(400);
	});
	it("cancels a pending plugin without changing saved credentials", async () => {
		const pending = handleIntegrationGuidedSetup(
			"guidedtest",
			request({ botToken: "wait" }),
		);
		await new Promise((resolve) => setTimeout(resolve, 100));
		handleIntegrationSetupCancel("guidedtest");
		expect((await pending).status).toBe(400);
		expect(readCredentials().integrations?.guidedtest?.botToken).toBe(
			"saved-secret",
		);
	});
});
