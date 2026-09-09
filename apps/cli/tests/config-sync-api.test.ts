import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyPendingDatabaseRestore } from "@toby/core/config/database-backup";
import {
	DATABASE_SYNC_BACKUP_LIMIT,
	listDatabaseSyncBackups,
	restoreDatabaseSyncBackup,
} from "@toby/core/config/database-sync-backups";
import {
	clearCredentialsCache,
	clearMemoryCredentialsKeyStore,
	getProjectsDir,
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
import { resolveListenRecordingsDir } from "@toby/core/listen/recordings";
import { closeMemoryDb } from "@toby/core/memory/memory-store";
import { createProject, listProjects } from "@toby/core/projects";
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

	it("opts into daily database backups and restores project files and recordings", async () => {
		await withTempDirs(async () => {
			writeConfig({ integrations: {}, personas: [] });
			writeCredentials({});
			// Seed a managed project and a recording so the snapshot has files.
			const project = createProject({ name: "Synced Project" });
			const outputPath = path.join(project.folderPath, "outputs", "result.txt");
			fs.mkdirSync(path.dirname(outputPath), { recursive: true });
			fs.writeFileSync(outputPath, "synced project output", "utf-8");
			const recordingDir = path.join(
				resolveListenRecordingsDir(),
				"sync-rec-1",
			);
			fs.mkdirSync(recordingDir, { recursive: true });
			fs.writeFileSync(
				path.join(recordingDir, "combined.m4a"),
				Buffer.from([9, 8, 7, 6, 5]),
			);

			await handleWebRequest(
				new Request("http://127.0.0.1/api/config/sync/enable", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ password: "vault", mode: "create" }),
				}),
				null,
			);

			const enable = await handleWebRequest(
				new Request("http://127.0.0.1/api/config/sync/data-backups/enable", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ enabled: true }),
				}),
				null,
			);
			expect(enable.status).toBe(200);
			const enabled = (await enable.json()) as {
				status: { databaseBackupsEnabled: boolean };
			};
			expect(enabled.status.databaseBackupsEnabled).toBe(true);

			const list = await handleWebRequest(
				new Request("http://127.0.0.1/api/config/sync/data-backups"),
				null,
			);
			expect(list.status).toBe(200);
			const body = (await list.json()) as {
				backups: Array<{
					deviceId: string;
					filename: string;
					deviceName: string;
					path: string;
					includesProjects: boolean;
					includesRecordings: boolean;
				}>;
			};
			expect(body.backups).toHaveLength(1);
			expect(body.backups[0]?.deviceId.length).toBeGreaterThan(0);
			expect(body.backups[0]?.filename).toMatch(/\.tbybak$/);
			expect(body.backups[0]?.deviceName.length).toBeGreaterThan(0);
			expect(body.backups[0]?.path).toContain("data-backups");
			expect(body.backups[0]?.includesProjects).toBe(true);
			expect(body.backups[0]?.includesRecordings).toBe(true);

			// Wipe project files and recordings, then restore the snapshot.
			closeChatDb();
			fs.rmSync(getProjectsDir(), { recursive: true, force: true });
			fs.rmSync(resolveListenRecordingsDir(), { recursive: true, force: true });

			const snapshot = body.backups[0];
			if (!snapshot) throw new Error("database backup was not listed");
			await restoreDatabaseSyncBackup({
				deviceId: snapshot.deviceId,
				filename: snapshot.filename,
			});
			expect(applyPendingDatabaseRestore()).toBe(true);

			const projects = listProjects();
			expect(projects).toHaveLength(1);
			const restoredProject = projects[0];
			if (!restoredProject) throw new Error("project was not restored");
			expect(restoredProject.folderPath.startsWith(getProjectsDir())).toBe(
				true,
			);
			expect(
				fs.readFileSync(
					path.join(restoredProject.folderPath, "outputs", "result.txt"),
					"utf-8",
				),
			).toBe("synced project output");
			expect(
				fs.readFileSync(
					path.join(resolveListenRecordingsDir(), "sync-rec-1", "combined.m4a"),
				),
			).toEqual(Buffer.from([9, 8, 7, 6, 5]));
		});
	});

	it("keeps only the latest three data backups per Mac", async () => {
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
			const statusRes = await handleWebRequest(
				new Request("http://127.0.0.1/api/config/sync"),
				null,
			);
			const status = (await statusRes.json()) as { deviceId: string };
			const dir = path.join(
				process.env.TOBY_SYNC_DIR as string,
				"data-backups",
				status.deviceId,
			);
			fs.mkdirSync(dir, { recursive: true });
			for (let day = 1; day <= 5; day++) {
				const createdAt = `2026-09-0${day}T12:00:00.000Z`;
				const filename = `${createdAt.replace(/[:.]/g, "-")}.json`;
				fs.writeFileSync(
					path.join(dir, filename),
					JSON.stringify({
						version: 1,
						format: "toby.database.backup.encrypted",
						deviceId: status.deviceId,
						deviceName: "Test Mac",
						createdAt,
						encryption: { cipher: "aes-256-gcm" },
						ciphertext: "x",
					}),
				);
			}
			const listed = await listDatabaseSyncBackups();
			expect(listed).toHaveLength(DATABASE_SYNC_BACKUP_LIMIT);
			expect(listed.map((backup) => backup.createdAt)).toEqual([
				"2026-09-05T12:00:00.000Z",
				"2026-09-04T12:00:00.000Z",
				"2026-09-03T12:00:00.000Z",
			]);
			expect(fs.readdirSync(dir)).toHaveLength(DATABASE_SYNC_BACKUP_LIMIT);
			expect(listed[0]?.path).toContain(dir);
			expect(listed[0]?.includesProjects).toBe(false);
			expect(listed[0]?.includesRecordings).toBe(false);
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
