import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	clearCredentialsCache,
	getConfigPath,
	getCredentialsPath,
	readConfig,
	readCredentials,
	setDefaultPersona,
	writeConfig,
	writeCredentials,
} from "@toby/core/config/index";

let tempDir: string;
let previousTobyDir: string | undefined;

beforeEach(() => {
	tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toby-config-test-"));
	previousTobyDir = process.env.TOBY_DIR;
	process.env.TOBY_DIR = tempDir;
	clearCredentialsCache();
});

afterEach(() => {
	clearCredentialsCache();
	if (previousTobyDir === undefined) {
		Reflect.deleteProperty(process.env, "TOBY_DIR");
	} else {
		process.env.TOBY_DIR = previousTobyDir;
	}
	fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("readConfig", () => {
	it("returns empty config when file does not exist", () => {
		const config = readConfig();
		expect(config).toEqual({ integrations: {}, personas: [] });
	});

	it("reads existing config", () => {
		const data = {
			integrations: {
				todoist: { apiKey: "x", mode: "y" },
			},
		};
		fs.writeFileSync(getConfigPath(), JSON.stringify(data));
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
		const raw = fs.readFileSync(getConfigPath(), "utf-8");
		expect(JSON.parse(raw)).toEqual(data);
	});
});

describe("readCredentials", () => {
	it("returns empty when file does not exist", () => {
		const creds = readCredentials();
		expect(creds).toEqual({});
	});

	it("reads existing credentials", () => {
		const data = { todoist: { apiKey: "abc", mode: "def" } };
		writeCredentials(data);
		clearCredentialsCache();
		const creds = readCredentials();
		expect(creds.todoist?.apiKey).toBe("abc");
	});
});

describe("config paths", () => {
	it("resolves config and credentials paths from TOBY_DIR override", () => {
		expect(getConfigPath()).toBe(path.join(tempDir, "config.json"));
		expect(getCredentialsPath()).toBe(path.join(tempDir, "credentials.json"));
	});
});
