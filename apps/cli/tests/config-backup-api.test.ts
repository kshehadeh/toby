import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isEncryptedBackupFile } from "@toby/core/config/backup";
import {
	clearCredentialsCache,
	clearMemoryCredentialsKeyStore,
	readConfig,
	readCredentials,
	resetCredentialsKeyStoreCache,
	writeConfig,
	writeCredentials,
} from "@toby/core/config/index";
import { handleWebRequest } from "@toby/core/web/routes";

function withTempTobyDir(run: () => Promise<void>): Promise<void> {
	const previousTobyDir = process.env.TOBY_DIR;
	const previousBackend = process.env.TOBY_CREDENTIALS_KEY_BACKEND;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-backup-api-"));
	process.env.TOBY_DIR = dir;
	process.env.TOBY_CREDENTIALS_KEY_BACKEND = "memory";
	clearCredentialsCache();
	clearMemoryCredentialsKeyStore();
	resetCredentialsKeyStoreCache();
	return run().finally(() => {
		clearCredentialsCache();
		clearMemoryCredentialsKeyStore();
		resetCredentialsKeyStoreCache();
		if (previousTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		if (previousBackend === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_CREDENTIALS_KEY_BACKEND");
		} else {
			process.env.TOBY_CREDENTIALS_KEY_BACKEND = previousBackend;
		}
		fs.rmSync(dir, { recursive: true, force: true });
	});
}

describe("POST /api/config/backup and restore", () => {
	beforeEach(() => {
		clearCredentialsCache();
		clearMemoryCredentialsKeyStore();
		resetCredentialsKeyStoreCache();
	});

	afterEach(() => {
		clearCredentialsCache();
		clearMemoryCredentialsKeyStore();
		resetCredentialsKeyStoreCache();
	});

	it("creates an encrypted backup and restores it", async () => {
		await withTempTobyDir(async () => {
			writeConfig({
				integrations: {
					email: { connectedAt: "2026-01-01T00:00:00.000Z" },
					notion: { connectedAt: "2026-01-02T00:00:00.000Z" },
				},
				personas: [],
				defaultPersona: "Toby",
				listen: { summaryPersona: "Toby" },
			});
			writeCredentials({
				ai: { openai: { token: "sk-backup-test" } },
				integrations: {
					email: {
						imapHost: "imap.example.com",
						imapPort: "993",
						imapUsername: "user@example.com",
						imapPassword: "secret-mail",
					},
					notion: { apiKey: "ntn-secret" },
				},
			});

			const backupRes = await handleWebRequest(
				new Request("http://127.0.0.1/api/config/backup", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ password: "test-pass" }),
				}),
				null,
			);
			expect(backupRes.status).toBe(200);
			const backupBody = (await backupRes.json()) as {
				backup: unknown;
				suggestedFileName: string;
			};
			expect(isEncryptedBackupFile(backupBody.backup)).toBe(true);
			expect(backupBody.suggestedFileName).toMatch(/\.tbybak$/);
			expect(JSON.stringify(backupBody.backup)).not.toContain("sk-backup-test");
			expect(JSON.stringify(backupBody.backup)).not.toContain("secret-mail");

			// Wipe live data
			writeConfig({ integrations: {}, personas: [] });
			writeCredentials({});
			expect(readCredentials().ai?.openai?.token).toBeUndefined();

			const restoreRes = await handleWebRequest(
				new Request("http://127.0.0.1/api/config/restore", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						backup: backupBody.backup,
						password: "test-pass",
						confirm: true,
					}),
				}),
				null,
			);
			expect(restoreRes.status).toBe(200);
			expect(readCredentials().ai?.openai?.token).toBe("sk-backup-test");
			expect(readCredentials().integrations?.email?.imapPassword).toBe(
				"secret-mail",
			);
			expect(readCredentials().integrations?.notion?.apiKey).toBe("ntn-secret");
			expect(readConfig().defaultPersona).toBe("Toby");
			expect(readConfig().integrations?.email?.connectedAt).toBe(
				"2026-01-01T00:00:00.000Z",
			);
			expect(readConfig().listen?.summaryPersona).toBe("Toby");
		});
	});

	it("rejects restore without confirm", async () => {
		await withTempTobyDir(async () => {
			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/config/restore", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						backup: {
							version: 1,
							createdAt: new Date().toISOString(),
							config: { integrations: {}, personas: [] },
							credentials: {},
						},
						confirm: false,
					}),
				}),
				null,
			);
			expect(res.status).toBe(400);
		});
	});

	it("rejects backup without password", async () => {
		await withTempTobyDir(async () => {
			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/config/backup", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ password: "" }),
				}),
				null,
			);
			expect(res.status).toBe(400);
		});
	});
});
