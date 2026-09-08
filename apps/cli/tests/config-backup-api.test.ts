import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	encryptBackupPayload,
	isEncryptedBackupFile,
} from "@toby/core/config/backup";
import {
	PENDING_MANIFEST,
	applyPendingDatabaseRestore,
	createDatabaseBackupBundle,
} from "@toby/core/config/database-backup";
import {
	clearCredentialsCache,
	clearMemoryCredentialsKeyStore,
	getProjectsDir,
	readConfig,
	readConfigRaw,
	readCredentials,
	resetCredentialsKeyStoreCache,
	writeConfig,
	writeCredentials,
} from "@toby/core/config/index";
import { resolveListenRecordingsDir } from "@toby/core/listen/recordings";
import { closeMemoryDb } from "@toby/core/memory/memory-store";
import { createProject, listProjects } from "@toby/core/projects";
import { closeChatDb } from "@toby/core/session-store";
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

function seedProjectAndRecording(): void {
	const project = createProject({ name: "Backup Project" });
	const outputPath = path.join(project.folderPath, "outputs", "result.txt");
	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, "project output", "utf-8");
	const recordingDir = path.join(resolveListenRecordingsDir(), "rec-1");
	fs.mkdirSync(recordingDir, { recursive: true });
	fs.writeFileSync(
		path.join(recordingDir, "combined.m4a"),
		Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
	);
}

describe("POST /api/config/backup and restore", () => {
	beforeEach(() => {
		closeChatDb();
		closeMemoryDb();
		clearCredentialsCache();
		clearMemoryCredentialsKeyStore();
		resetCredentialsKeyStoreCache();
	});

	afterEach(() => {
		closeChatDb();
		closeMemoryDb();
		clearCredentialsCache();
		clearMemoryCredentialsKeyStore();
		resetCredentialsKeyStoreCache();
	});

	it("streams an encrypted archive backup and restores it as a binary upload", async () => {
		await withTempTobyDir(async () => {
			writeConfig({
				integrations: {
					email: { connectedAt: "2026-01-01T00:00:00.000Z" },
				},
				personas: [],
				defaultPersona: "Toby",
				listen: { summaryPersona: "Toby" },
			});
			writeCredentials({
				ai: { openai: { token: "sk-backup-test" } },
				integrations: {
					email: { imapPassword: "secret-mail" },
				},
			});
			seedProjectAndRecording();

			const backupRes = await handleWebRequest(
				new Request("http://127.0.0.1/api/config/backup", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ password: "test-pass" }),
				}),
				null,
			);
			expect(backupRes.status).toBe(200);
			expect(backupRes.headers.get("Content-Type")).toContain(
				"application/octet-stream",
			);
			expect(backupRes.headers.get("X-Toby-Backup-Filename")).toMatch(
				/\.tbybak$/,
			);
			const backupBytes = Buffer.from(await backupRes.arrayBuffer());
			expect(backupBytes.subarray(0, 10).toString("utf8")).toBe("TOBYBACKUP");
			expect(backupBytes.toString("latin1")).not.toContain("sk-backup-test");
			expect(backupBytes.toString("latin1")).not.toContain("secret-mail");

			// Wipe live data.
			closeChatDb();
			closeMemoryDb();
			const tobyDir = process.env.TOBY_DIR as string;
			fs.rmSync(getProjectsDir(), { recursive: true, force: true });
			fs.rmSync(resolveListenRecordingsDir(), { recursive: true, force: true });
			fs.rmSync(path.join(tobyDir, "chat.sqlite"), { force: true });
			fs.rmSync(path.join(tobyDir, "memory.sqlite"), { force: true });
			fs.rmSync(path.join(tobyDir, "config.json"), { force: true });
			fs.rmSync(path.join(tobyDir, "credentials.json"), { force: true });

			const restoreRes = await handleWebRequest(
				new Request("http://127.0.0.1/api/config/restore", {
					method: "POST",
					headers: {
						"Content-Type": "application/octet-stream",
						"X-Backup-Password": "test-pass",
						"X-Backup-Confirm": "true",
					},
					body: backupBytes,
				}),
				null,
			);
			expect(restoreRes.status).toBe(200);
			const restoreBody = (await restoreRes.json()) as {
				ok: boolean;
				databasesStaged: boolean;
				projectsStaged: boolean;
				recordingsStaged: boolean;
				restarting: boolean;
			};
			expect(restoreBody.ok).toBe(true);
			expect(restoreBody.databasesStaged).toBe(true);
			expect(restoreBody.projectsStaged).toBe(true);
			expect(restoreBody.recordingsStaged).toBe(true);
			expect(restoreBody.restarting).toBe(false);
			expect(fs.existsSync(path.join(tobyDir, PENDING_MANIFEST))).toBe(true);

			// Settings apply immediately.
			expect(readCredentials().ai?.openai?.token).toBe("sk-backup-test");
			expect(readCredentials().integrations?.email?.imapPassword).toBe(
				"secret-mail",
			);
			expect(readConfig().defaultPersona).toBe("Toby");
			expect(readConfig().integrations?.email?.connectedAt).toBe(
				"2026-01-01T00:00:00.000Z",
			);

			expect(applyPendingDatabaseRestore()).toBe(true);
			const projects = listProjects();
			expect(projects).toHaveLength(1);
			const restoredProject = projects[0];
			if (!restoredProject) throw new Error("project was not restored");
			expect(
				fs.readFileSync(
					path.join(restoredProject.folderPath, "outputs", "result.txt"),
					"utf-8",
				),
			).toBe("project output");
			expect(
				fs.readFileSync(
					path.join(resolveListenRecordingsDir(), "rec-1", "combined.m4a"),
				),
			).toEqual(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
		});
	});

	it("still accepts legacy JSON envelope restores", async () => {
		await withTempTobyDir(async () => {
			writeConfig({
				integrations: {},
				personas: [],
				defaultPersona: "Toby",
			});
			writeCredentials({});
			const envelope = await encryptBackupPayload(
				JSON.stringify({
					version: 2,
					createdAt: new Date().toISOString(),
					config: readConfigRaw(),
					credentials: readCredentials(),
					databases: createDatabaseBackupBundle(),
				}),
				"test-pass",
			);
			expect(isEncryptedBackupFile(envelope)).toBe(true);

			const restoreRes = await handleWebRequest(
				new Request("http://127.0.0.1/api/config/restore", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						backup: envelope,
						password: "test-pass",
						confirm: true,
					}),
				}),
				null,
			);
			expect(restoreRes.status).toBe(200);
			const restoreBody = (await restoreRes.json()) as {
				ok: boolean;
				databasesStaged: boolean;
			};
			expect(restoreBody.ok).toBe(true);
			expect(restoreBody.databasesStaged).toBe(true);
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

	it("rejects binary restore without confirm header", async () => {
		await withTempTobyDir(async () => {
			const res = await handleWebRequest(
				new Request("http://127.0.0.1/api/config/restore", {
					method: "POST",
					headers: {
						"Content-Type": "application/octet-stream",
						"X-Backup-Password": "test-pass",
					},
					body: Buffer.from("TOBYBACKUP\t1\t0000000000000030\n"),
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
