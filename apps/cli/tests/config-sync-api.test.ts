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
import { closeMemoryDb } from "@toby/core/memory/memory-store";
import { closeChatDb } from "@toby/core/session-store";
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
		closeChatDb();
		closeMemoryDb();
		resetSyncDirty();
		resetSyncPassphraseStore();
		clearCredentialsCache();
		clearMemoryCredentialsKeyStore();
		resetCredentialsKeyStoreCache();
	});

	afterEach(() => {
		closeChatDb();
		closeMemoryDb();
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
			const body = (await res.json()) as {
				enabled: boolean;
				deviceId: string;
				backend: string;
				storeAvailable: boolean;
			};
			expect(body.enabled).toBe(false);
			expect(body.deviceId.length).toBeGreaterThan(0);
			expect(body.backend).toBe("icloud");
			expect(body.storeAvailable).toBe(true);
		});
	});

	it("opts into daily database backups and lists the initial snapshot", async () => {
		await withTempDirs(async () => {
			writeConfig({ integrations: {}, personas: [] });
			writeCredentials({});
			await handleWebRequest(
				new Request("http://127.0.0.1/api/config/sync/enable", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ password: "vault", mode: "create" }),
				}),
				null,
			);

			const enable = await handleWebRequest(
				new Request(
					"http://127.0.0.1/api/config/sync/database-backups/enable",
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ enabled: true }),
					},
				),
				null,
			);
			expect(enable.status).toBe(200);
			const enabled = (await enable.json()) as {
				status: { databaseBackupsEnabled: boolean };
			};
			expect(enabled.status.databaseBackupsEnabled).toBe(true);

			const list = await handleWebRequest(
				new Request("http://127.0.0.1/api/config/sync/database-backups"),
				null,
			);
			expect(list.status).toBe(200);
			const body = (await list.json()) as {
				backups: Array<{ deviceId: string }>;
			};
			expect(body.backups).toHaveLength(1);
			expect(body.backups[0]?.deviceId.length).toBeGreaterThan(0);
		});
	});

	it("enables folder backend via HTTP", async () => {
		await withTempDirs(async () => {
			const previousSyncDir = process.env.TOBY_SYNC_DIR;
			Reflect.deleteProperty(process.env, "TOBY_SYNC_DIR");
			const picked = fs.mkdtempSync(
				path.join(os.tmpdir(), "toby-sync-api-picked-"),
			);
			try {
				writeConfig({
					integrations: {},
					personas: [],
					defaultPersona: "HttpFolder",
				});
				writeCredentials({ ai: { openai: { token: "sk-http-folder" } } });
				const enableRes = await handleWebRequest(
					new Request("http://127.0.0.1/api/config/sync/enable", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							password: "vault",
							mode: "create",
							backend: "folder",
							folderPath: picked,
						}),
					}),
					null,
				);
				expect(enableRes.status).toBe(200);
				const enabled = (await enableRes.json()) as {
					enabled: boolean;
					backend: string;
					folderPath: string;
					storeAvailable: boolean;
				};
				expect(enabled.enabled).toBe(true);
				expect(enabled.backend).toBe("folder");
				expect(enabled.folderPath).toBe(path.resolve(picked));
				expect(enabled.storeAvailable).toBe(true);

				const statusRes = await handleWebRequest(
					new Request("http://127.0.0.1/api/config/sync"),
					null,
				);
				const status = (await statusRes.json()) as { backend: string };
				expect(status.backend).toBe("folder");
			} finally {
				if (previousSyncDir === undefined) {
					Reflect.deleteProperty(process.env, "TOBY_SYNC_DIR");
				} else {
					process.env.TOBY_SYNC_DIR = previousSyncDir;
				}
				fs.rmSync(picked, { recursive: true, force: true });
			}
		});
	});

	it("rejects folder backend without folderPath", async () => {
		await withTempDirs(async () => {
			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/config/sync/enable", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						password: "vault",
						backend: "folder",
					}),
				}),
				null,
			);
			expect(res.status).toBe(400);
		});
	});
});
