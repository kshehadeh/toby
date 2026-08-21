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
	SYNC_HISTORY_LIMIT,
	createFilesystemSyncBlobStore,
	disableSync,
	enableSync,
	isSyncDirty,
	pullSnapshot,
	pushSnapshot,
	resetSyncDirty,
	resetSyncPassphraseStore,
	restoreSyncHistory,
	runSyncTick,
	setSyncBlobStoreForTests,
	shouldPushNow,
} from "@toby/core/config/sync";

function withTempDirs(run: () => Promise<void>): Promise<void> {
	const previousTobyDir = process.env.TOBY_DIR;
	const previousSyncDir = process.env.TOBY_SYNC_DIR;
	const previousBackend = process.env.TOBY_CREDENTIALS_KEY_BACKEND;
	const tobyDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-sync-home-"));
	const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-sync-vault-"));
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

describe("config sync engine", () => {
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

	it("create enable pushes local settings and join applies them on a second home", async () => {
		await withTempDirs(async () => {
			writeConfig({
				integrations: { slack: { connectedAt: "2026-01-01T00:00:00.000Z" } },
				personas: [],
				defaultPersona: "Toby",
				activeProject: "should-stay-local",
				web: { port: 1234 },
			});
			writeCredentials({ ai: { openai: { token: "sk-shared" } } });

			const store = createFilesystemSyncBlobStore(process.env.TOBY_SYNC_DIR);
			await enableSync({ password: "vault", mode: "create", store });
			expect(await store.readCurrent()).not.toBeNull();

			const firstHome = process.env.TOBY_DIR as string;
			const secondHome = fs.mkdtempSync(
				path.join(os.tmpdir(), "toby-sync-home-b-"),
			);
			process.env.TOBY_DIR = secondHome;
			clearCredentialsCache();
			clearMemoryCredentialsKeyStore();
			resetCredentialsKeyStoreCache();
			resetSyncPassphraseStore();
			resetSyncDirty();
			writeConfig({
				integrations: {},
				personas: [],
				activeProject: "mac-b-project",
				web: { port: 7847 },
			});
			writeCredentials({});

			await enableSync({ password: "vault", mode: "join", store });
			expect(readCredentials().ai?.openai?.token).toBe("sk-shared");
			expect(readConfig().defaultPersona).toBe("Toby");
			expect(readConfig().integrations?.slack?.connectedAt).toBe(
				"2026-01-01T00:00:00.000Z",
			);
			expect(readConfig().activeProject).toBe("mac-b-project");
			expect(readConfig().web?.port).toBe(7847);
			expect(isSyncDirty()).toBe(false);

			process.env.TOBY_DIR = firstHome;
			fs.rmSync(secondHome, { recursive: true, force: true });
		});
	});

	it("refuses create when a vault already exists", async () => {
		await withTempDirs(async () => {
			writeConfig({ integrations: {}, personas: [] });
			writeCredentials({});
			const store = createFilesystemSyncBlobStore(process.env.TOBY_SYNC_DIR);
			await enableSync({ password: "vault", mode: "create", store });
			await expect(
				enableSync({ password: "vault", mode: "create", store }),
			).rejects.toThrow(/already exists/);
		});
	});

	it("refuses replace of an existing vault with empty local settings", async () => {
		await withTempDirs(async () => {
			writeConfig({
				integrations: { slack: { connectedAt: "x" } },
				personas: [],
			});
			writeCredentials({ ai: { openai: { token: "sk" } } });
			const store = createFilesystemSyncBlobStore(process.env.TOBY_SYNC_DIR);
			await enableSync({ password: "vault", mode: "create", store });

			const otherHome = fs.mkdtempSync(
				path.join(os.tmpdir(), "toby-sync-empty-"),
			);
			process.env.TOBY_DIR = otherHome;
			clearCredentialsCache();
			clearMemoryCredentialsKeyStore();
			resetCredentialsKeyStoreCache();
			resetSyncPassphraseStore();
			writeConfig({ integrations: {}, personas: [] });
			writeCredentials({});
			await expect(
				enableSync({ password: "vault", mode: "replace", store }),
			).rejects.toThrow(/no settings to upload/);
			fs.rmSync(otherHome, { recursive: true, force: true });
		});
	});

	it("does not rewrite local files when the remote hash matches", async () => {
		await withTempDirs(async () => {
			writeConfig({
				integrations: {},
				personas: [],
				defaultPersona: "Toby",
			});
			writeCredentials({ ai: { openai: { token: "sk" } } });
			const store = createFilesystemSyncBlobStore(process.env.TOBY_SYNC_DIR);
			await enableSync({ password: "vault", mode: "create", store });
			const credPath = path.join(
				process.env.TOBY_DIR as string,
				"credentials.json",
			);
			const before = fs.statSync(credPath).mtimeMs;
			await new Promise((r) => setTimeout(r, 20));
			const result = await pullSnapshot({ store, confirm: true });
			expect(result.applied).toBe(false);
			expect(result.reason).toBe("unchanged");
			expect(fs.statSync(credPath).mtimeMs).toBe(before);
		});
	});

	it("pull apply does not mark dirty so the next tick does not push", async () => {
		await withTempDirs(async () => {
			writeConfig({
				integrations: {},
				personas: [],
				defaultPersona: "One",
			});
			writeCredentials({});
			const store = createFilesystemSyncBlobStore(process.env.TOBY_SYNC_DIR);
			await enableSync({ password: "vault", mode: "create", store });

			const homeA = process.env.TOBY_DIR as string;
			const homeB = fs.mkdtempSync(path.join(os.tmpdir(), "toby-sync-b-"));
			process.env.TOBY_DIR = homeB;
			clearCredentialsCache();
			clearMemoryCredentialsKeyStore();
			resetCredentialsKeyStoreCache();
			resetSyncPassphraseStore();
			resetSyncDirty();
			writeConfig({ integrations: {}, personas: [], defaultPersona: "Two" });
			writeCredentials({ ai: { openai: { token: "sk-b" } } });
			await enableSync({ password: "vault", mode: "replace", store });

			process.env.TOBY_DIR = homeA;
			clearCredentialsCache();
			resetSyncPassphraseStore();
			// Re-enable passphrase on A by joining isn't needed; password is per-home memory store.
			// Recreate A's enable by setting passphrase via another join-less push path:
			await enableSync({ password: "vault", mode: "join", store });
			expect(readConfig().defaultPersona).toBe("Two");
			expect(isSyncDirty()).toBe(false);
			const tick = await runSyncTick(store);
			expect(tick.action).not.toBe("push");
			fs.rmSync(homeB, { recursive: true, force: true });
		});
	});

	it("keeps at most 10 history snapshots", async () => {
		await withTempDirs(async () => {
			writeConfig({ integrations: {}, personas: [], defaultPersona: "v0" });
			writeCredentials({});
			const store = createFilesystemSyncBlobStore(process.env.TOBY_SYNC_DIR);
			await enableSync({ password: "vault", mode: "create", store });
			for (let i = 1; i <= 12; i++) {
				writeConfig({
					integrations: {},
					personas: [],
					defaultPersona: `v${i}`,
				});
				await pushSnapshot({ store, force: true });
			}
			const history = await store.listHistory();
			expect(history.length).toBe(SYNC_HISTORY_LIMIT);
		});
	});

	it("restore-history applies an older snapshot and pushes it as current", async () => {
		await withTempDirs(async () => {
			writeConfig({ integrations: {}, personas: [], defaultPersona: "first" });
			writeCredentials({ ai: { openai: { token: "sk-1" } } });
			const store = createFilesystemSyncBlobStore(process.env.TOBY_SYNC_DIR);
			await enableSync({ password: "vault", mode: "create", store });
			writeConfig({ integrations: {}, personas: [], defaultPersona: "second" });
			writeCredentials({ ai: { openai: { token: "sk-2" } } });
			await pushSnapshot({ store, force: true });
			const history = await store.listHistory();
			expect(history.length).toBeGreaterThan(0);
			const oldest = history[history.length - 1];
			await restoreSyncHistory({
				filename: oldest.filename,
				confirm: true,
				store,
			});
			expect(readConfig().defaultPersona).toBe("first");
			expect(readCredentials().ai?.openai?.token).toBe("sk-1");
		});
	});

	it("wrong join password fails closed without wiping local config", async () => {
		await withTempDirs(async () => {
			writeConfig({
				integrations: {},
				personas: [],
				defaultPersona: "keep-me",
			});
			writeCredentials({ ai: { openai: { token: "sk-keep" } } });
			const store = createFilesystemSyncBlobStore(process.env.TOBY_SYNC_DIR);
			await enableSync({ password: "vault", mode: "create", store });

			const other = fs.mkdtempSync(path.join(os.tmpdir(), "toby-sync-wrong-"));
			process.env.TOBY_DIR = other;
			clearCredentialsCache();
			clearMemoryCredentialsKeyStore();
			resetCredentialsKeyStoreCache();
			resetSyncPassphraseStore();
			writeConfig({ integrations: {}, personas: [], defaultPersona: "local" });
			writeCredentials({ ai: { openai: { token: "sk-local" } } });
			await expect(
				enableSync({ password: "nope", mode: "join", store }),
			).rejects.toThrow(/Could not decrypt/);
			expect(readConfig().defaultPersona).toBe("local");
			expect(readCredentials().ai?.openai?.token).toBe("sk-local");
			fs.rmSync(other, { recursive: true, force: true });
		});
	});

	it("shouldPushNow waits for debounce after a local write", async () => {
		await withTempDirs(async () => {
			resetSyncDirty();
			writeConfig({ integrations: {}, personas: [] });
			expect(isSyncDirty()).toBe(true);
			expect(shouldPushNow(Date.now(), 5_000)).toBe(false);
			expect(shouldPushNow(Date.now() + 6_000, 5_000)).toBe(true);
		});
	});

	it("disable leaves or deletes the cloud vault", async () => {
		await withTempDirs(async () => {
			writeConfig({ integrations: {}, personas: [] });
			writeCredentials({});
			const store = createFilesystemSyncBlobStore(process.env.TOBY_SYNC_DIR);
			await enableSync({ password: "vault", mode: "create", store });
			await disableSync({ store });
			expect(await store.readCurrent()).not.toBeNull();
			await enableSync({ password: "vault", mode: "join", store });
			await disableSync({ store, deleteCloud: true });
			expect(await store.readCurrent()).toBeNull();
		});
	});
});
