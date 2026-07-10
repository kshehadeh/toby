import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	getConfigPath,
	getCredentialsPath,
	readConfig,
	readCredentials,
	setDefaultPersona,
	writeConfig,
} from "@toby/core/config/index";

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
				todoist: { apiKey: "x", mode: "y" },
			},
		};
		fs.writeFileSync(CONFIG_PATH, JSON.stringify(data));
		const config = readConfig();
		expect(config.integrations.todoist.apiKey).toBe("x");
	});

	it("preserves dashboard settings through read/write", () => {
		writeConfig({
			integrations: {},
			personas: [],
			dashboard: { persona: "Dashboard Updater" },
			defaultPersona: "Toby",
		});
		expect(readConfig().dashboard).toEqual({ persona: "Dashboard Updater" });

		// read → mutate → write must not drop dashboard (e.g. set-default-persona).
		setDefaultPersona("Other");
		const config = readConfig();
		expect(config.defaultPersona).toBe("Other");
		expect(config.dashboard).toEqual({ persona: "Dashboard Updater" });
	});
});

describe("writeConfig", () => {
	it("writes config to disk", () => {
		const data = {
			integrations: {
				todoist: { apiKey: "a", mode: "b" },
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
		const data = { todoist: { apiKey: "abc", mode: "def" } };
		fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(data));
		const creds = readCredentials();
		expect(creds.todoist?.apiKey).toBe("abc");
	});
});

describe("config paths", () => {
	it("resolves config and credentials paths from TOBY_DIR override", () => {
		const previousTobyDir = process.env.TOBY_DIR;
		process.env.TOBY_DIR = "/tmp/toby-test-dir";

		try {
			expect(getConfigPath()).toBe("/tmp/toby-test-dir/config.json");
			expect(getCredentialsPath()).toBe("/tmp/toby-test-dir/credentials.json");
		} finally {
			if (previousTobyDir === undefined) {
				process.env.TOBY_DIR = undefined;
			} else {
				process.env.TOBY_DIR = previousTobyDir;
			}
		}
	});
});
