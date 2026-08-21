import { describe, expect, it } from "bun:test";
import { compareSyncClock, nextSyncClock } from "@toby/core/config/sync-clock";
import {
	decryptSyncPayload,
	encryptSyncPayload,
	isEncryptedSyncFile,
} from "@toby/core/config/sync-crypto";
import {
	type SyncPayload,
	hashPayload,
	mergeDeniedConfigKeys,
	stableStringify,
	stripDeniedConfigKeys,
} from "@toby/core/config/sync-payload";

describe("config sync encryption", () => {
	it("encrypts and decrypts a sync payload", async () => {
		const plaintext = JSON.stringify({
			version: 1,
			config: { integrations: {}, personas: [] },
			credentials: { ai: { openai: { token: "sk-secret" } } },
		});
		const clock = nextSyncClock(
			0,
			"device-a",
			"Mac A",
			new Date("2026-08-21T00:00:00.000Z"),
		);
		const encrypted = await encryptSyncPayload(plaintext, "vault-pass", {
			clock,
			contentHash: "abc",
			createdAt: clock.utc,
		});
		expect(isEncryptedSyncFile(encrypted)).toBe(true);
		expect(encrypted.format).toBe("toby.config.sync.encrypted");
		expect(JSON.stringify(encrypted)).not.toContain("sk-secret");
		expect(encrypted.ciphertext).not.toContain("sk-secret");

		const decrypted = await decryptSyncPayload(encrypted, "vault-pass");
		expect(decrypted).toBe(plaintext);
	});

	it("rejects decryption with the wrong password", async () => {
		const clock = nextSyncClock(0, "device-a", "Mac A");
		const encrypted = await encryptSyncPayload("{}", "correct-password", {
			clock,
			contentHash: "x",
			createdAt: clock.utc,
		});
		await expect(
			decryptSyncPayload(encrypted, "wrong-password"),
		).rejects.toThrow(/Could not decrypt the sync vault/);
	});
});

describe("sync clock", () => {
	it("prefers higher lamport", () => {
		const a = nextSyncClock(2, "a", "A", new Date("2026-01-01T00:00:00.000Z"));
		const b = nextSyncClock(1, "b", "B", new Date("2026-12-01T00:00:00.000Z"));
		expect(compareSyncClock(a, b)).toBeGreaterThan(0);
	});

	it("breaks equal lamport with later utc then deviceId", () => {
		const earlier = {
			lamport: 3,
			utc: "2026-01-01T00:00:00.000Z",
			deviceId: "zzz",
			deviceName: "Z",
		};
		const later = {
			lamport: 3,
			utc: "2026-01-02T00:00:00.000Z",
			deviceId: "aaa",
			deviceName: "A",
		};
		expect(compareSyncClock(later, earlier)).toBeGreaterThan(0);
		const idA = { ...earlier, deviceId: "aaa" };
		const idB = { ...earlier, deviceId: "bbb" };
		expect(compareSyncClock(idB, idA)).toBeGreaterThan(0);
	});
});

describe("sync payload denylist", () => {
	it("strips machine-local keys", () => {
		const stripped = stripDeniedConfigKeys({
			integrations: { slack: { connectedAt: "x" } },
			activeProject: "home",
			web: { port: 9999 },
			personas: [],
		});
		expect(stripped.activeProject).toBeUndefined();
		expect(stripped.web).toBeUndefined();
		expect(stripped.integrations).toEqual({ slack: { connectedAt: "x" } });
	});

	it("keeps local denylisted keys when merging a remote config", () => {
		const merged = mergeDeniedConfigKeys(
			{ integrations: {}, personas: [], defaultPersona: "Toby" },
			{ activeProject: "local-proj", web: { port: 1111 } },
		);
		expect(merged.activeProject).toBe("local-proj");
		expect(merged.web).toEqual({ port: 1111 });
		expect(merged.defaultPersona).toBe("Toby");
	});

	it("hashes payloads stably regardless of key order", () => {
		const a: SyncPayload = {
			version: 1,
			config: { b: 1, a: 2 },
			credentials: { z: { k: "1" }, a: { k: "2" } },
		};
		const b: SyncPayload = {
			version: 1,
			config: { a: 2, b: 1 },
			credentials: { a: { k: "2" }, z: { k: "1" } },
		};
		expect(stableStringify(a)).toBe(stableStringify(b));
		expect(hashPayload(a)).toBe(hashPayload(b));
	});
});
