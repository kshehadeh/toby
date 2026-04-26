import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConfig, readCredentials, writeConfig } from "../src/config/index";

const TOBY_DIR = path.join(os.homedir(), ".toby");
const CONFIG_PATH = path.join(TOBY_DIR, "config.json");
const CREDENTIALS_PATH = path.join(TOBY_DIR, "credentials.json");

let originalConfig: string | null = null;
let originalCreds: string | null = null;

beforeEach(() => {
	if (fs.existsSync(CONFIG_PATH)) {
		originalConfig = fs.readFileSync(CONFIG_PATH, "utf-8");
	}
	if (fs.existsSync(CREDENTIALS_PATH)) {
		originalCreds = fs.readFileSync(CREDENTIALS_PATH, "utf-8");
	}
});

afterEach(() => {
	if (originalConfig !== null) {
		fs.writeFileSync(CONFIG_PATH, originalConfig);
	} else if (fs.existsSync(CONFIG_PATH)) {
		fs.unlinkSync(CONFIG_PATH);
	}
	if (originalCreds !== null) {
		fs.writeFileSync(CREDENTIALS_PATH, originalCreds);
	} else if (fs.existsSync(CREDENTIALS_PATH)) {
		fs.unlinkSync(CREDENTIALS_PATH);
	}
});

describe("readConfig", () => {
	it("returns empty config when file does not exist", () => {
		if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
		const config = readConfig();
		expect(config).toEqual({ integrations: {}, personas: [] });
	});

	it("reads existing config", () => {
		const data = {
			integrations: {
				gmail: { accessToken: "x", refreshToken: "y", expiresAt: 1 },
			},
		};
		fs.writeFileSync(CONFIG_PATH, JSON.stringify(data));
		const config = readConfig();
		expect(config.integrations.gmail.accessToken).toBe("x");
	});
});

describe("writeConfig", () => {
	it("writes config to disk", () => {
		const data = {
			integrations: {
				gmail: { accessToken: "a", refreshToken: "b", expiresAt: 2 },
			},
		};
		writeConfig(data);
		const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
		expect(JSON.parse(raw)).toEqual(data);
	});
});

describe("readCredentials", () => {
	it("returns empty when file does not exist", () => {
		if (fs.existsSync(CREDENTIALS_PATH)) fs.unlinkSync(CREDENTIALS_PATH);
		const creds = readCredentials();
		expect(creds).toEqual({});
	});

	it("reads existing credentials", () => {
		const data = { gmail: { clientId: "abc", clientSecret: "def" } };
		fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(data));
		const creds = readCredentials();
		expect(creds.gmail?.clientId).toBe("abc");
	});
});
