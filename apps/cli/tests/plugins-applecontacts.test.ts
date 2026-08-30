import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	createPluginIntegrationModule,
	loadPluginMetadata,
} from "@toby/core/integrations/plugins/adapter";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const pluginDir = path.join(repoRoot, "plugin-applecontacts");
const pluginEntry = path.join(pluginDir, "src/index.ts");

function runPlugin(
	args: string[],
	options: {
		stdin?: unknown;
		home?: string;
		env?: Record<string, string>;
	} = {},
): { exitCode: number; stdout: string; stderr: string } {
	const proc = spawnSync(process.execPath, ["run", pluginEntry, ...args], {
		cwd: pluginDir,
		input:
			options.stdin === undefined ? undefined : JSON.stringify(options.stdin),
		env: {
			...process.env,
			...(options.home ? { HOME: options.home } : {}),
			...(options.home && options.env?.TOBY_DIR === undefined
				? { TOBY_DIR: path.join(options.home, ".toby") }
				: {}),
			...(options.env ?? {}),
		},
		encoding: "utf8",
	});
	return {
		exitCode: proc.status ?? 1,
		stdout: (proc.stdout ?? "").trim(),
		stderr: (proc.stderr ?? "").trim(),
	};
}

function parseJson(stdout: string): Record<string, unknown> {
	return JSON.parse(stdout) as Record<string, unknown>;
}

describe("Apple Contacts plugin", () => {
	let tempHome: string | undefined;

	afterEach(() => {
		if (tempHome) {
			fs.rmSync(tempHome, { recursive: true, force: true });
			tempHome = undefined;
		}
	});

	it("reports status metadata and contacts provider category", () => {
		tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "toby-applecontacts-"));
		const result = runPlugin(["status"], {
			home: tempHome,
			stdin: { state: { connectedAt: "2026-07-01T00:00:00.000Z" } },
		});
		expect(result.exitCode).toBe(0);
		const body = parseJson(result.stdout);
		expect(body.ok).toBe(true);
		expect(body.name).toBe("applecontacts");
		expect(body.displayName).toBe("Apple Contacts");
		expect(body.connected).toBe(false);
		expect(body.capabilities).toEqual(["chat"]);
		expect(body.providerCategories).toEqual(["contacts"]);
		expect(body.resources).toEqual(["contacts"]);
		expect(body.chatModelPrep).toBeDefined();
		expect(body.chatReadiness).toEqual({
			ok: false,
			hint: "Toby.app is not running. Launch Toby.app to enable Apple Contacts tools.",
		});
	});

	it("lists the expected contact tools as read-only", () => {
		const result = runPlugin(["tools", "list"]);
		expect(result.exitCode).toBe(0);
		const body = parseJson(result.stdout) as {
			ok: boolean;
			tools: Array<{ name: string; readOnly?: boolean }>;
		};
		expect(body.ok).toBe(true);
		expect(body.tools.map((tool) => tool.name)).toEqual([
			"searchContacts",
			"getContact",
		]);
		expect(body.tools.every((tool) => tool.readOnly)).toBe(true);
	});

	it("honors dryRun for search without calling native endpoints", () => {
		const result = runPlugin(["tools", "execute"], {
			stdin: {
				tool: "searchContacts",
				input: { query: "Ada" },
				dryRun: true,
			},
		});
		expect(result.exitCode).toBe(0);
		const body = parseJson(result.stdout) as {
			ok: boolean;
			result: { dryRun?: boolean; message?: string };
		};
		expect(body.ok).toBe(true);
		expect(body.result.dryRun).toBe(true);
		expect(body.result.message).toBe(
			"Would search Apple Contacts with the given filters.",
		);
	});

	it("connect fails clearly when native Contacts access fails", () => {
		tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "toby-applecontacts-"));
		fs.mkdirSync(path.join(tempHome, ".toby"), { recursive: true });
		fs.writeFileSync(path.join(tempHome, ".toby", "native-port"), "49152");
		const binDir = path.join(tempHome, "bin");
		fs.mkdirSync(binDir, { recursive: true });
		fs.writeFileSync(
			path.join(binDir, "curl"),
			`#!/bin/zsh
url="\${@: -1}"
case "$url" in
  */api/native/health) printf "200" ;;
  */api/native/contacts/request-access) printf '{"ok":false,"error":"Contacts access denied."}' ;;
  *) printf '{"ok":false,"error":"unknown"}' ;;
esac
`,
			{ mode: 0o755 },
		);
		const result = runPlugin(["connect"], {
			home: tempHome,
			env: { PATH: `${binDir}:${process.env.PATH ?? ""}` },
		});
		expect(result.exitCode).toBe(0);
		const body = parseJson(result.stdout);
		expect(body.ok).toBe(false);
		expect(body.reason).toBe(
			"Contacts.app access request failed: Contacts access denied.",
		);
	});

	it("connect requests native Contacts access before validating search", () => {
		tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "toby-applecontacts-"));
		fs.mkdirSync(path.join(tempHome, ".toby"), { recursive: true });
		fs.writeFileSync(path.join(tempHome, ".toby", "native-port"), "49152");
		const binDir = path.join(tempHome, "bin");
		const callsFile = path.join(tempHome, "curl-calls.txt");
		fs.mkdirSync(binDir, { recursive: true });
		fs.writeFileSync(
			path.join(binDir, "curl"),
			`#!/bin/zsh
url="\${@: -1}"
print -- "$url" >> ${JSON.stringify(callsFile)}
case "$url" in
  */api/native/health) printf "200" ;;
  */api/native/contacts/request-access) printf '{"ok":true,"data":{"prompted":true}}' ;;
  */api/native/contacts/search) printf '{"ok":true,"data":{"contacts":[],"count":0}}' ;;
  *) printf '{"ok":false,"error":"unknown"}' ;;
esac
`,
			{ mode: 0o755 },
		);

		const result = runPlugin(["connect"], {
			home: tempHome,
			env: { PATH: `${binDir}:${process.env.PATH ?? ""}` },
		});
		expect(result.exitCode).toBe(0);
		const body = parseJson(result.stdout);
		expect(body).toEqual({
			ok: true,
			reason: "Apple Contacts connected successfully.",
		});
		const calls = fs.readFileSync(callsFile, "utf8").trim().split("\n");
		expect(calls.some((call) => call.endsWith("/api/native/health"))).toBe(
			true,
		);
		expect(
			calls.some((call) =>
				call.endsWith("/api/native/contacts/request-access"),
			),
		).toBe(true);
		expect(
			calls.some((call) => call.endsWith("/api/native/contacts/search")),
		).toBe(true);
		expect(
			calls.findIndex((call) =>
				call.endsWith("/api/native/contacts/request-access"),
			),
		).toBeLessThan(
			calls.findIndex((call) => call.endsWith("/api/native/contacts/search")),
		);
	});

	it("connect finds native-port under TOBY_DIR when HOME has none", () => {
		tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "toby-applecontacts-"));
		const tobyDir = path.join(tempHome, "custom-toby");
		fs.mkdirSync(tobyDir, { recursive: true });
		// Intentionally no $HOME/.toby/native-port — only TOBY_DIR.
		fs.writeFileSync(path.join(tobyDir, "native-port"), "49152");
		const binDir = path.join(tempHome, "bin");
		fs.mkdirSync(binDir, { recursive: true });
		fs.writeFileSync(
			path.join(binDir, "curl"),
			`#!/bin/zsh
url="\${@: -1}"
case "$url" in
  */api/native/health) printf "200" ;;
  */api/native/contacts/request-access) printf '{"ok":true,"data":{"prompted":true}}' ;;
  */api/native/contacts/search) printf '{"ok":true,"data":{"contacts":[],"count":0}}' ;;
  *) printf '{"ok":false,"error":"unknown"}' ;;
esac
`,
			{ mode: 0o755 },
		);

		const result = runPlugin(["connect"], {
			home: tempHome,
			env: {
				PATH: `${binDir}:${process.env.PATH ?? ""}`,
				TOBY_DIR: tobyDir,
			},
		});
		expect(result.exitCode).toBe(0);
		expect(parseJson(result.stdout)).toEqual({
			ok: true,
			reason: "Apple Contacts connected successfully.",
		});
	});

	it("core test connection does not mention credentials for no-config plugin", async () => {
		tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "toby-applecontacts-"));
		const previousTobyDir = process.env.TOBY_DIR;
		try {
			process.env.TOBY_DIR = path.join(tempHome, "toby-home");
			const metadata = loadPluginMetadata({
				kind: "bun-package",
				directoryPath: pluginDir,
				binaryName: "toby-plugin-applecontacts",
				manifestPath: path.join(pluginDir, "manifest.json"),
				entryPath: pluginEntry,
			});
			expect("error" in metadata).toBe(false);
			if ("error" in metadata) {
				throw new Error(metadata.error);
			}
			const module = createPluginIntegrationModule(metadata);

			const result = await module.testConnection();
			expect(result.ok).toBe(false);
			expect(result.details).toBe(
				"Apple Contacts is not connected. Run `toby connect applecontacts` on this Mac.",
			);
		} finally {
			if (previousTobyDir === undefined) {
				Reflect.deleteProperty(process.env, "TOBY_DIR");
			} else {
				process.env.TOBY_DIR = previousTobyDir;
			}
		}
	});

	it("validates required detail input", () => {
		const result = runPlugin(["tools", "execute"], {
			stdin: {
				tool: "getContact",
				input: {},
				dryRun: true,
			},
		});
		expect(result.exitCode).toBe(0);
		const body = parseJson(result.stdout);
		expect(body.ok).toBe(false);
		expect(body.error).toBe("identifier is required.");
	});
});
