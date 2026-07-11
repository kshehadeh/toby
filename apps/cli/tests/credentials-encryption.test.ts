import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	CREDENTIALS_KEY_LENGTH,
	decryptCredentialsPayload,
	encryptCredentialsPayload,
	isEncryptedCredentialsEnvelope as isEnvelope,
} from "@toby/core/config/credentials-crypto";
import {
	MemoryCredentialsKeyStore,
	resolveCredentialsKeyBackend,
} from "@toby/core/config/credentials-keychain";
import {
	CREDENTIALS_ENVELOPE_FORMAT,
	CREDENTIALS_KEY_BACKEND_ENV,
	clearCredentialsCache,
	clearMemoryCredentialsKeyStore,
	getCredentialsPath,
	isEncryptedCredentialsEnvelope,
	readCredentials,
	resetCredentialsKeyStoreCache,
	writeCredentials,
} from "@toby/core/config/index";

function withTempTobyDir(run: () => void): void {
	const previousTobyDir = process.env.TOBY_DIR;
	const previousBackend = process.env[CREDENTIALS_KEY_BACKEND_ENV];
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-creds-enc-"));
	process.env.TOBY_DIR = dir;
	process.env[CREDENTIALS_KEY_BACKEND_ENV] = "memory";
	clearCredentialsCache();
	clearMemoryCredentialsKeyStore();
	resetCredentialsKeyStoreCache();
	try {
		run();
	} finally {
		clearCredentialsCache();
		clearMemoryCredentialsKeyStore();
		resetCredentialsKeyStoreCache();
		if (previousTobyDir === undefined) {
			Reflect.deleteProperty(process.env, "TOBY_DIR");
		} else {
			process.env.TOBY_DIR = previousTobyDir;
		}
		if (previousBackend === undefined) {
			Reflect.deleteProperty(process.env, CREDENTIALS_KEY_BACKEND_ENV);
		} else {
			process.env[CREDENTIALS_KEY_BACKEND_ENV] = previousBackend;
		}
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

describe("credentials-crypto", () => {
	it("round-trips AES-GCM encryption", () => {
		const key = Buffer.alloc(CREDENTIALS_KEY_LENGTH, 7);
		const plaintext = JSON.stringify({
			ai: { openai: { token: "sk-secret-value" } },
		});
		const envelope = encryptCredentialsPayload(plaintext, key);
		expect(envelope.format).toBe(CREDENTIALS_ENVELOPE_FORMAT);
		expect(isEnvelope(envelope)).toBe(true);
		expect(decryptCredentialsPayload(envelope, key)).toBe(plaintext);
	});

	it("fails decrypt with the wrong key", () => {
		const key = Buffer.alloc(CREDENTIALS_KEY_LENGTH, 1);
		const wrong = Buffer.alloc(CREDENTIALS_KEY_LENGTH, 2);
		const envelope = encryptCredentialsPayload('{"a":1}', key);
		expect(() => decryptCredentialsPayload(envelope, wrong)).toThrow(
			/Could not decrypt credentials/,
		);
	});

	it("rejects wrong key length", () => {
		expect(() => encryptCredentialsPayload("{}", Buffer.alloc(16))).toThrow(
			/32 bytes/,
		);
	});
});

describe("writeCredentials / readCredentials encryption", () => {
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

	it("writes an encrypted envelope that does not contain the secret plaintext", () => {
		withTempTobyDir(() => {
			const secret = "sk-super-secret-token-xyz";
			writeCredentials({ ai: { openai: { token: secret } } });

			const raw = fs.readFileSync(getCredentialsPath(), "utf-8");
			expect(raw).not.toContain(secret);
			const parsed = JSON.parse(raw) as unknown;
			expect(isEncryptedCredentialsEnvelope(parsed)).toBe(true);

			const creds = readCredentials();
			expect(creds.ai?.openai?.token).toBe(secret);
		});
	});

	it("round-trips nested integration credentials", () => {
		withTempTobyDir(() => {
			const original = {
				integrations: {
					slack: {
						botToken: "xoxb-test",
						clientSecret: "secret-value",
					},
					jira: {
						apiToken: "jira-token",
						email: "user@example.com",
					},
				},
				ai: { openrouter: { apiKey: "or-key" } },
			};
			writeCredentials(original);
			expect(readCredentials()).toEqual(original);
			// Second read hits cache / decrypt again
			expect(readCredentials()).toEqual(original);
		});
	});

	it("migrates legacy plaintext credentials on read", () => {
		withTempTobyDir(() => {
			const legacy = {
				ai: { openai: { token: "sk-legacy" } },
				integrations: { notion: { apiKey: "ntn-key" } },
			};
			fs.writeFileSync(getCredentialsPath(), JSON.stringify(legacy, null, 2));

			const creds = readCredentials();
			expect(creds.ai?.openai?.token).toBe("sk-legacy");
			expect(creds.integrations?.notion?.apiKey).toBe("ntn-key");

			const raw = fs.readFileSync(getCredentialsPath(), "utf-8");
			expect(raw).not.toContain("sk-legacy");
			expect(isEncryptedCredentialsEnvelope(JSON.parse(raw))).toBe(true);
		});
	});

	it("returns empty object when credentials file is missing", () => {
		withTempTobyDir(() => {
			expect(readCredentials()).toEqual({});
		});
	});

	it("throws when encrypted file exists but memory key was wiped", () => {
		withTempTobyDir(() => {
			writeCredentials({ ai: { openai: { token: "sk-lost-key" } } });
			clearMemoryCredentialsKeyStore();
			resetCredentialsKeyStoreCache();
			clearCredentialsCache();
			// Recreate empty memory store (no key)
			expect(() => readCredentials()).toThrow(
				/Keychain data key is missing|data key is missing/,
			);
		});
	});

	it("does not use memory encryption without TOBY_DIR (avoids locking real ~/.toby)", () => {
		const previousTobyDir = process.env.TOBY_DIR;
		const previousBackend = process.env[CREDENTIALS_KEY_BACKEND_ENV];
		// Simulate the dangerous misconfiguration that corrupted real credentials
		// during early test runs: memory backend without an isolated TOBY_DIR.
		Reflect.deleteProperty(process.env, "TOBY_DIR");
		process.env[CREDENTIALS_KEY_BACKEND_ENV] = "memory";
		clearCredentialsCache();
		clearMemoryCredentialsKeyStore();
		resetCredentialsKeyStoreCache();
		try {
			// Should resolve to plaintext, not memory.
			expect(resolveCredentialsKeyBackend()).toBe("plaintext");
		} finally {
			clearCredentialsCache();
			clearMemoryCredentialsKeyStore();
			resetCredentialsKeyStoreCache();
			if (previousTobyDir === undefined) {
				Reflect.deleteProperty(process.env, "TOBY_DIR");
			} else {
				process.env.TOBY_DIR = previousTobyDir;
			}
			if (previousBackend === undefined) {
				Reflect.deleteProperty(process.env, CREDENTIALS_KEY_BACKEND_ENV);
			} else {
				process.env[CREDENTIALS_KEY_BACKEND_ENV] = previousBackend;
			}
		}
	});

	it("writes with mode 0o600", () => {
		withTempTobyDir(() => {
			writeCredentials({ ai: { openai: { token: "sk-mode" } } });
			const mode = fs.statSync(getCredentialsPath()).mode & 0o777;
			expect(mode).toBe(0o600);
		});
	});

	it("plaintext backend keeps readable JSON on disk", () => {
		const previousTobyDir = process.env.TOBY_DIR;
		const previousBackend = process.env[CREDENTIALS_KEY_BACKEND_ENV];
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-creds-plain-"));
		process.env.TOBY_DIR = dir;
		process.env[CREDENTIALS_KEY_BACKEND_ENV] = "plaintext";
		clearCredentialsCache();
		resetCredentialsKeyStoreCache();
		try {
			writeCredentials({ ai: { openai: { token: "sk-plain" } } });
			const raw = fs.readFileSync(getCredentialsPath(), "utf-8");
			expect(JSON.parse(raw)).toEqual({
				ai: { openai: { token: "sk-plain" } },
			});
			expect(readCredentials().ai?.openai?.token).toBe("sk-plain");
		} finally {
			clearCredentialsCache();
			resetCredentialsKeyStoreCache();
			if (previousTobyDir === undefined) {
				Reflect.deleteProperty(process.env, "TOBY_DIR");
			} else {
				process.env.TOBY_DIR = previousTobyDir;
			}
			if (previousBackend === undefined) {
				Reflect.deleteProperty(process.env, CREDENTIALS_KEY_BACKEND_ENV);
			} else {
				process.env[CREDENTIALS_KEY_BACKEND_ENV] = previousBackend;
			}
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("MemoryCredentialsKeyStore", () => {
	it("creates a stable key until deleted", () => {
		const store = new MemoryCredentialsKeyStore();
		const a = store.getOrCreateDataKey();
		const b = store.getOrCreateDataKey();
		expect(a.equals(b)).toBe(true);
		expect(a.length).toBe(CREDENTIALS_KEY_LENGTH);
		store.deleteDataKey();
		expect(store.getDataKey()).toBeNull();
		const c = store.getOrCreateDataKey();
		expect(c.equals(a)).toBe(false);
	});
});
