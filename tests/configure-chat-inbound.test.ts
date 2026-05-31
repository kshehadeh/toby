import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readConfig } from "../src/config/index";
import { createConfigureSession } from "../src/ui/configure/session";

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "toby-configure-"));
}

afterEach(() => {
	const dir = process.env.TOBY_DIR;
	if (dir && fs.existsSync(dir)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
	Reflect.deleteProperty(process.env, "TOBY_DIR");
});

describe("configure chat inbound", () => {
	it("persists chatInbound and integration inboundEnabled on save", () => {
		process.env.TOBY_DIR = makeTempDir();
		const session = createConfigureSession();
		const values = {
			...session.initialValues,
			"chatInbound.enabled": "true",
			"chatInbound.integration": "slack",
			"chatInbound.persona": "(default)",
			"slack.inboundEnabled": "true",
		};
		session.onSave(values);

		const cfg = readConfig();
		expect(cfg.chatInbound?.enabled).toBe(true);
		expect(cfg.chatInbound?.integration).toBe("slack");
		expect(
			(cfg.integrations.slack as { inboundEnabled?: boolean })?.inboundEnabled,
		).toBe(true);
	});
});
