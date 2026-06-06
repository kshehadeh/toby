import {
	applyConfigureValuesPatch,
	collectSecretConfigureKeys,
	redactConfigureValues,
	seedConfigureValues,
} from "@toby/core/configure/persistence";
import { describe, expect, it } from "vitest";
import { handleWebRequest } from "@toby/core/web/routes";

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

	it("rejects patching secret configure keys", () => {
		expect(() =>
			applyConfigureValuesPatch({ "ai.openai.token": "new-secret" }),
		).toThrow(/secret field/i);
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

	it("handles POST /api/daemon/restart", async () => {
		const res = await handleWebRequest(
			new Request("http://127.0.0.1/api/daemon/restart", { method: "POST" }),
			null,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, restarting: true });
	});
});
