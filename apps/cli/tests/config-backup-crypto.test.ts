import { describe, expect, it } from "vitest";
import {
	decryptBackupPayload,
	encryptBackupPayload,
	isEncryptedBackupFile,
} from "../src/commands/config-backup-crypto";

describe("config backup encryption", () => {
	it("encrypts and decrypts backup payload with a password", async () => {
		const plaintext = JSON.stringify({
			version: 1,
			createdAt: "2026-04-27T00:00:00.000Z",
			config: { integrations: {}, personas: [] },
			credentials: { gmail: { clientId: "abc", clientSecret: "def" } },
		});
		const password = "test-password";

		const encrypted = await encryptBackupPayload(plaintext, password);
		expect(isEncryptedBackupFile(encrypted)).toBe(true);
		expect(encrypted.ciphertext).not.toContain("clientSecret");

		const decrypted = await decryptBackupPayload(encrypted, password);
		expect(decrypted).toBe(plaintext);
	});

	it("rejects decryption with an incorrect password", async () => {
		const encrypted = await encryptBackupPayload(
			JSON.stringify({
				version: 1,
				createdAt: "2026-04-27T00:00:00.000Z",
				config: { integrations: {}, personas: [] },
				credentials: {},
			}),
			"correct-password",
		);

		await expect(
			decryptBackupPayload(encrypted, "wrong-password"),
		).rejects.toThrow(/Could not decrypt backup/);
	});
});
