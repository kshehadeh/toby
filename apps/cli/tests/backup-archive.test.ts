import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeToolResultCacheDb } from "@toby/core/chat-pipeline/tool-result-cache";
import {
	createConfigBackupArchive,
	encryptBackupPayload,
	isBackupArchiveFile,
	restoreConfigBackupFile,
} from "@toby/core/config/backup";
import {
	isSafeEntryKey,
	isSafeRelativePath,
} from "@toby/core/config/backup-file-restore";
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

function withTempTobyDir(run: () => Promise<void>): Promise<void> {
	const previousTobyDir = process.env.TOBY_DIR;
	const previousBackend = process.env.TOBY_CREDENTIALS_KEY_BACKEND;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-archive-"));
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

function resetDbSingletons(): void {
	closeToolResultCacheDb();
	closeChatDb();
	closeMemoryDb();
}

function wipeLiveFiles(): void {
	const tobyDir = process.env.TOBY_DIR as string;
	fs.rmSync(getProjectsDir(), { recursive: true, force: true });
	fs.rmSync(resolveListenRecordingsDir(), { recursive: true, force: true });
	fs.rmSync(path.join(tobyDir, "chat.sqlite"), { force: true });
	fs.rmSync(path.join(tobyDir, "memory.sqlite"), { force: true });
	fs.rmSync(path.join(tobyDir, "config.json"), { force: true });
	fs.rmSync(path.join(tobyDir, "credentials.json"), { force: true });
}

function seedManagedProject(): { outputPath: string } {
	const project = createProject({ name: "Managed Project" });
	const outputPath = path.join(project.folderPath, "outputs", "result.txt");
	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, "managed result", "utf-8");
	return { outputPath };
}

function seedRecording(): { audio: Buffer; dir: string } {
	const recordingsRoot = resolveListenRecordingsDir();
	const dir = path.join(recordingsRoot, "rec-1");
	fs.mkdirSync(dir, { recursive: true });
	const audio = Buffer.alloc(512 * 1024);
	for (let i = 0; i < audio.length; i += 256) {
		audio.write(`audio-${i}-`, i, "utf-8");
	}
	fs.writeFileSync(path.join(dir, "combined.m4a"), audio);
	fs.writeFileSync(
		path.join(dir, "metadata.json"),
		JSON.stringify({
			id: "rec-1",
			createdAt: new Date().toISOString(),
			sources: { mic: true, system: true },
			files: {},
		}),
		"utf-8",
	);
	fs.writeFileSync(
		path.join(dir, "transcript.txt"),
		"transcribed words",
		"utf-8",
	);
	fs.mkdirSync(path.join(recordingsRoot, ".tmp"), { recursive: true });
	fs.writeFileSync(
		path.join(recordingsRoot, ".tmp", "live.wav"),
		"wip",
		"utf-8",
	);
	return { audio, dir };
}

beforeEach(() => {
	resetDbSingletons();
	clearCredentialsCache();
	clearMemoryCredentialsKeyStore();
	resetCredentialsKeyStoreCache();
});

afterEach(() => {
	resetDbSingletons();
	clearCredentialsCache();
	clearMemoryCredentialsKeyStore();
	resetCredentialsKeyStoreCache();
});

describe("backup archive round trip", () => {
	it("backs up and restores settings, databases, project files, and recordings", async () => {
		await withTempTobyDir(async () => {
			writeConfig({
				integrations: {},
				personas: [],
				defaultPersona: "Toby",
				listen: { summaryPersona: "Toby" },
			});
			writeCredentials({
				ai: { openai: { token: "sk-archive-test" } },
			});

			// Custom-folder project with nested files, empty dir, exec bit, symlink.
			const customDir = fs.mkdtempSync(
				path.join(os.tmpdir(), "toby-custom-project-"),
			);
			const custom = createProject({
				name: "Custom Project",
				folderPath: customDir,
			});
			fs.writeFileSync(
				path.join(customDir, "notes.md"),
				"hello custom",
				"utf-8",
			);
			const nestedDir = path.join(customDir, "nested");
			fs.mkdirSync(nestedDir, { recursive: true });
			const binData = Buffer.from([0, 1, 2, 3, 254, 255, 7, 8, 9, 10]);
			fs.writeFileSync(path.join(nestedDir, "data.bin"), binData);
			fs.mkdirSync(path.join(customDir, "empty-dir"), { recursive: true });
			fs.writeFileSync(path.join(customDir, "run.sh"), "#!/bin/sh\necho hi\n", {
				mode: 0o755,
			});
			fs.writeFileSync(path.join(customDir, "empty.txt"), "");
			fs.symlinkSync("notes.md", path.join(customDir, "alias.md"));

			const { outputPath } = seedManagedProject();
			const { audio, dir: recordingDir } = seedRecording();

			const backupPath = path.join(
				os.tmpdir(),
				`toby-archive-test-${process.pid}-${Date.now()}.tbybak`,
			);
			try {
				const created = await createConfigBackupArchive(
					"pw-strong",
					backupPath,
				);
				expect(created.suggestedFileName).toMatch(/\.tbybak$/);
				expect(created.filePath).toBe(backupPath);
				expect(isBackupArchiveFile(backupPath)).toBe(true);
				expect(
					created.skipped.some((note) => note.includes("symbolic link")),
				).toBe(true);

				// Wipe every piece of live data.
				resetDbSingletons();
				wipeLiveFiles();

				const staged = await restoreConfigBackupFile(backupPath, "pw-strong");
				expect(staged.databasesStaged).toBe(true);
				expect(staged.projectsStaged).toBe(true);
				expect(staged.recordingsStaged).toBe(true);

				// Settings apply immediately; files wait for the daemon restart.
				expect(readCredentials().ai?.openai?.token).toBe("sk-archive-test");
				expect(readConfig().defaultPersona).toBe("Toby");
				expect(readConfig().listen?.summaryPersona).toBe("Toby");
				const tobyDir = process.env.TOBY_DIR as string;
				expect(fs.existsSync(path.join(tobyDir, PENDING_MANIFEST))).toBe(true);

				expect(applyPendingDatabaseRestore()).toBe(true);

				// Projects restored into Toby-managed folders with rewritten paths.
				const projects = listProjects();
				expect(projects).toHaveLength(2);
				const restoredCustom = projects.find(
					(p) => p.name === "Custom Project",
				);
				if (!restoredCustom) throw new Error("Custom Project was not restored");
				const expectedFolder = path.join(getProjectsDir(), restoredCustom.id);
				expect(restoredCustom.folderPath).toBe(expectedFolder);
				expect(
					fs.readFileSync(path.join(expectedFolder, "notes.md"), "utf-8"),
				).toBe("hello custom");
				expect(
					fs.readFileSync(path.join(expectedFolder, "nested", "data.bin")),
				).toEqual(binData);
				expect(
					fs.statSync(path.join(expectedFolder, "run.sh")).mode & 0o777,
				).toBe(0o755);
				expect(fs.existsSync(path.join(expectedFolder, "empty-dir"))).toBe(
					true,
				);
				expect(fs.statSync(path.join(expectedFolder, "empty.txt")).size).toBe(
					0,
				);

				const restoredManaged = projects.find(
					(p) => p.name === "Managed Project",
				);
				if (!restoredManaged)
					throw new Error("Managed Project was not restored");
				expect(restoredManaged.folderPath.startsWith(getProjectsDir())).toBe(
					true,
				);
				expect(
					fs.readFileSync(
						path.join(restoredManaged.folderPath, "outputs", "result.txt"),
						"utf-8",
					),
				).toBe("managed result");

				// The original custom folder is untouched.
				expect(fs.readFileSync(path.join(customDir, "notes.md"), "utf-8")).toBe(
					"hello custom",
				);

				// Recordings restored byte-identical; temp recording excluded.
				expect(
					fs.readFileSync(path.join(recordingDir, "combined.m4a")),
				).toEqual(audio);
				expect(
					fs.readFileSync(path.join(recordingDir, "transcript.txt"), "utf-8"),
				).toBe("transcribed words");
				expect(
					fs.existsSync(path.join(resolveListenRecordingsDir(), ".tmp")),
				).toBe(false);

				// The pending restore is fully consumed.
				expect(fs.existsSync(path.join(tobyDir, PENDING_MANIFEST))).toBe(false);
				expect(applyPendingDatabaseRestore()).toBe(false);
			} finally {
				fs.rmSync(backupPath, { force: true });
				fs.rmSync(customDir, { recursive: true, force: true });
			}
		});
	});

	it("legacy JSON backups restore databases without clearing project files or recordings", async () => {
		await withTempTobyDir(async () => {
			writeConfig({ integrations: {}, personas: [], defaultPersona: "Toby" });
			writeCredentials({ ai: { openai: { token: "sk-legacy" } } });
			const { outputPath } = seedManagedProject();
			const { dir: recordingDir } = seedRecording();

			const envelope = await encryptBackupPayload(
				JSON.stringify({
					version: 2,
					createdAt: new Date().toISOString(),
					config: readConfigRaw(),
					credentials: readCredentials(),
					databases: createDatabaseBackupBundle(),
				}),
				"legacy-pw",
			);
			const legacyPath = path.join(
				os.tmpdir(),
				`toby-legacy-test-${process.pid}-${Date.now()}.tbybak`,
			);
			try {
				fs.writeFileSync(
					legacyPath,
					JSON.stringify(envelope, null, 2),
					"utf-8",
				);
				expect(isBackupArchiveFile(legacyPath)).toBe(false);

				const result = await restoreConfigBackupFile(legacyPath, "legacy-pw");
				expect(result.databasesStaged).toBe(true);
				expect(result.projectsStaged).toBe(false);
				expect(result.recordingsStaged).toBe(false);
				expect(applyPendingDatabaseRestore()).toBe(true);

				const projects = listProjects();
				expect(projects).toHaveLength(1);
				expect(fs.existsSync(outputPath)).toBe(true);
				expect(fs.existsSync(path.join(recordingDir, "combined.m4a"))).toBe(
					true,
				);
			} finally {
				fs.rmSync(legacyPath, { force: true });
			}
		});
	});

	it("rejects a wrong password without staging or changing settings", async () => {
		await withTempTobyDir(async () => {
			writeConfig({ integrations: {}, personas: [], defaultPersona: "Toby" });
			writeCredentials({ ai: { openai: { token: "sk-keep" } } });
			const backupPath = path.join(
				os.tmpdir(),
				`toby-wrongpw-test-${process.pid}-${Date.now()}.tbybak`,
			);
			try {
				await createConfigBackupArchive("right-pw", backupPath);
				await expect(
					restoreConfigBackupFile(backupPath, "wrong-pw"),
				).rejects.toThrow(/Could not decrypt backup/);
				const tobyDir = process.env.TOBY_DIR as string;
				expect(fs.existsSync(path.join(tobyDir, PENDING_MANIFEST))).toBe(false);
				expect(readCredentials().ai?.openai?.token).toBe("sk-keep");
			} finally {
				fs.rmSync(backupPath, { force: true });
			}
		});
	});

	it("rejects a corrupted archive without applying anything", async () => {
		await withTempTobyDir(async () => {
			writeConfig({ integrations: {}, personas: [], defaultPersona: "Toby" });
			writeCredentials({ ai: { openai: { token: "sk-keep" } } });
			seedManagedProject();
			seedRecording();
			const backupPath = path.join(
				os.tmpdir(),
				`toby-corrupt-test-${process.pid}-${Date.now()}.tbybak`,
			);
			try {
				await createConfigBackupArchive("pw-strong", backupPath);
				const raw = fs.readFileSync(backupPath);
				const corruptAt = Math.floor(raw.length * 0.8);
				raw[corruptAt] = ((raw[corruptAt] ?? 0) + 1) % 256;
				fs.writeFileSync(backupPath, raw);

				await expect(
					restoreConfigBackupFile(backupPath, "pw-strong"),
				).rejects.toThrow();
				const tobyDir = process.env.TOBY_DIR as string;
				expect(fs.existsSync(path.join(tobyDir, PENDING_MANIFEST))).toBe(false);
				expect(readConfig().defaultPersona).toBe("Toby");
				expect(readCredentials().ai?.openai?.token).toBe("sk-keep");
				// No leftover staging directories.
				const leftovers = fs
					.readdirSync(tobyDir)
					.filter((name) => name.startsWith(".pending-restore-"));
				expect(leftovers).toHaveLength(0);
			} finally {
				fs.rmSync(backupPath, { force: true });
			}
		});
	});

	it("validates safe path and key rules", () => {
		expect(isSafeRelativePath("a/b.txt")).toBe(true);
		expect(isSafeRelativePath("a/b/c")).toBe(true);
		expect(isSafeRelativePath("../x")).toBe(false);
		expect(isSafeRelativePath("/x")).toBe(false);
		expect(isSafeRelativePath("a//b")).toBe(false);
		expect(isSafeRelativePath("a/./b")).toBe(false);
		expect(isSafeRelativePath("")).toBe(false);
		expect(isSafeEntryKey("0b7f6e2a-1c2d-4e5f-9876-abcdef123456")).toBe(true);
		expect(isSafeEntryKey("2026-01-01T00-00-00.000Z-abc123")).toBe(true);
		expect(isSafeEntryKey("..")).toBe(false);
		expect(isSafeEntryKey(".hidden")).toBe(false);
		expect(isSafeEntryKey("a/b")).toBe(false);
		expect(isSafeEntryKey("")).toBe(false);
	});
});
