import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	clearCredentialsCache,
	clearMemoryCredentialsKeyStore,
	readConfig,
	readCredentials,
	resetCredentialsKeyStoreCache,
	writeConfig,
	writeCredentials,
} from "@toby/core/config/index";
import {
	resetSyncDirty,
	resetSyncPassphraseStore,
	setSyncBlobStoreForTests,
} from "@toby/core/config/sync";
import { handleWebRequest } from "@toby/core/web/routes";

function withTempDirs(run: () => Promise<void>): Promise<void> {
	const previousTobyDir = process.env.TOBY_DIR;
	const previousSyncDir = process.env.TOBY_SYNC_DIR;
	const previousBackend = process.env.TOBY_CREDENTIALS_KEY_BACKEND;
	const tobyDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-sync-api-"));
	const syncDir = fs.mkdtempSync(
		path.join(os.tmpdir(), "toby-sync-api-vault-"),
	);
	process.env.TOBY_DIR = tobyDir;
	process.env.TOBY_SYNC_DIR = syncDir;
	process.env.TOBY_CREDENTIALS_KEY_BACKEND = "memory";
	clearCredentialsCache();
	clearMemoryCredentialsKeyStore();
	resetCredentialsKeyStoreCache();
	resetSyncPassphraseStore();
	resetSyncDirty();
	setSyncBlobStoreForTests(null);
	return run().finally(() => {
		clearCredentialsCache();
		clearMemoryCredentialsKeyStore();
		resetCredentialsKeyStoreCache();
		resetSyncPassphraseStore();
		resetSyncDirty();
		setSyncBlobStoreForTests(null);
		if (previousTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		if (previousSyncDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_SYNC_DIR");
		} else {
			process.env.TOBY_SYNC_DIR = previousSyncDir;
		}
		if (previousBackend === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_CREDENTIALS_KEY_BACKEND");
		} else {
			process.env.TOBY_CREDENTIALS_KEY_BACKEND = previousBackend;
		}
		fs.rmSync(tobyDir, { recursive: true, force: true });
		fs.rmSync(syncDir, { recursive: true, force: true });
	});
}

describe("POST /api/config/sync", () => {
	beforeEach(() => {
		resetSyncDirty();
		resetSyncPassphraseStore();
		clearCredentialsCache();
		clearMemoryCredentialsKeyStore();
		resetCredentialsKeyStoreCache();
	});

	afterEach(() => {
		resetSyncDirty();
		resetSyncPassphraseStore();
		clearCredentialsCache();
		clearMemoryCredentialsKeyStore();
		resetCredentialsKeyStoreCache();
		setSyncBlobStoreForTests(null);
	});

	it("enables, pushes, and restores via HTTP", async () => {
		await withTempDirs(async () => {
			writeConfig({
				integrations: {},
				personas: [],
				defaultPersona: "Toby",
			});
			writeCredentials({ ai: { openai: { token: "sk-http" } } });

			const enableRes = await handleWebRequest(
				new Request("http://127.0.0.1/api/config/sync/enable", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ password: "vault", mode: "create" }),
				}),
				null,
			);
			expect(enableRes.status).toBe(200);
			const enabled = (await enableRes.json()) as { enabled: boolean };
			expect(enabled.enabled).toBe(true);

			writeConfig({
				integrations: {},
				personas: [],
				defaultPersona: "Changed",
			});
			writeCredentials({ ai: { openai: { token: "sk-new" } } });

			const pushRes = await handleWebRequest(
				new Request("http://127.0.0.1/api/config/sync/push", {
					method: "POST",
				}),
				null,
			);
			expect(pushRes.status).toBe(200);

			const historyRes = await handleWebRequest(
				new Request("http://127.0.0.1/api/config/sync/history"),
				null,
			);
			expect(historyRes.status).toBe(200);
			const historyBody = (await historyRes.json()) as {
				history: Array<{ filename: string }>;
			};
			expect(historyBody.history.length).toBeGreaterThan(0);

			const restoreRes = await handleWebRequest(
				new Request("http://127.0.0.1/api/config/sync/restore-history", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						filename: historyBody.history[0].filename,
						confirm: true,
					}),
				}),
				null,
			);
			expect(restoreRes.status).toBe(200);
			expect(readConfig().defaultPersona).toBe("Toby");
			expect(readCredentials().ai?.openai?.token).toBe("sk-http");
		});
	});

	it("rejects pull and restore-history without confirm", async () => {
		await withTempDirs(async () => {
			const pullRes = await handleWebRequest(
				new Request("http://127.0.0.1/api/config/sync/pull", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ confirm: false }),
				}),
				null,
			);
			expect(pullRes.status).toBe(400);

			const restoreRes = await handleWebRequest(
				new Request("http://127.0.0.1/api/config/sync/restore-history", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ filename: "x.json" }),
				}),
				null,
			);
			expect(restoreRes.status).toBe(400);
		});
	});

	it("rejects enable without a password", async () => {
		await withTempDirs(async () => {
			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/config/sync/enable", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ password: "" }),
				}),
				null,
			);
			expect(res.status).toBe(400);
		});
	});

	it("GET /api/config/sync returns status", async () => {
		await withTempDirs(async () => {
			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/config/sync"),
				null,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { enabled: boolean; deviceId: string };
			expect(body.enabled).toBe(false);
			expect(body.deviceId.length).toBeGreaterThan(0);
		});
	});
});
