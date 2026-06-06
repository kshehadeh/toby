import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCredentials } from "@toby/core/config/index";
import {
	applyConfigureValuesPatch,
	collectSecretConfigureKeys,
	redactConfigureValues,
	seedConfigureValues,
} from "@toby/core/configure/persistence";
import { handleWebRequest } from "@toby/core/web/routes";
import { describe, expect, it } from "vitest";

function withTempTobyDir(run: () => void): void {
	const previous = process.env.TOBY_DIR;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-secret-test-"));
	process.env.TOBY_DIR = dir;
	try {
		run();
	} finally {
		if (previous === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previous;
		}
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

describe("configure persistence", () => {
	it("redacts masked credential values", () => {
		const values = {
			"ai.openai.token": "sk-secret",
			"chatInbound.enabled": "false",
		};
		const redacted = redactConfigureValues(values);
		expect(redacted["ai.openai.token"]).toBe("••••••");
		expect(redacted["chatInbound.enabled"]).toBe("false");
	});

	it("collects secret keys including integration masked fields", () => {
		const keys = collectSecretConfigureKeys();
		expect(keys.has("ai.openai.token")).toBe(true);
		expect(keys.has("ai.vercel.apiKey")).toBe(true);
	});

	it("persists secret configure keys to credentials", () => {
		withTempTobyDir(() => {
			applyConfigureValuesPatch({ "ai.openai.token": "new-secret" });
			expect(readCredentials().ai?.openai?.token).toBe("new-secret");
		});
	});

	it("keeps an existing secret when the redacted placeholder is patched", () => {
		withTempTobyDir(() => {
			applyConfigureValuesPatch({ "ai.openai.token": "keep-me" });
			applyConfigureValuesPatch({ "ai.openai.token": "••••••" });
			expect(readCredentials().ai?.openai?.token).toBe("keep-me");
		});
	});

	it("seeds configure values without throwing", () => {
		const values = seedConfigureValues();
		expect(typeof values["chatInbound.enabled"]).toBe("string");
	});
});

describe("web API routes", () => {
	it("handles GET /api/daemon/status", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/daemon/status"),
			null,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			chatInbound: { enabled: boolean; status: string };
		};
		expect(body.chatInbound).toMatchObject({
			enabled: expect.any(Boolean),
			status: expect.any(String),
		});
	});

	it("includes integration display names for configure selects", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/configure/tree"),
			null,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			integrationLabels: Record<string, string>;
		};
		expect(body.integrationLabels.gmail).toBe("Gmail");
		expect(body.integrationLabels.slack).toBe("Slack");
		expect(body.integrationLabels["(none)"]).toBe("None");
	});

	it("handles POST /api/daemon/restart", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/daemon/restart", { method: "POST" }),
			null,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, restarting: true });
	});
});
