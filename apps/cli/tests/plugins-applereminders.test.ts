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
const pluginDir = path.join(repoRoot, "plugin-applereminders");
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

describe("Apple Reminders plugin", () => {
	let tempHome: string | undefined;

	afterEach(() => {
		if (tempHome) {
			fs.rmSync(tempHome, { recursive: true, force: true });
			tempHome = undefined;
		}
	});

	it("reports status metadata and tasks provider category", () => {
		tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "toby-applereminders-"));
		const result = runPlugin(["status"], {
			home: tempHome,
			stdin: { state: { connectedAt: "2026-07-01T00:00:00.000Z" } },
		});
		expect(result.exitCode).toBe(0);
		const body = parseJson(result.stdout);
		expect(body.ok).toBe(true);
		expect(body.name).toBe("applereminders");
		expect(body.displayName).toBe("Apple Reminders");
		expect(body.connected).toBe(false);
		expect(body.capabilities).toEqual(["chat"]);
		expect(body.providerCategories).toEqual(["tasks"]);
		expect(body.resources).toEqual(["lists", "reminders"]);
		expect(body.chatModelPrep).toBeDefined();
		expect(body.chatReadiness).toEqual({
			ok: false,
			hint: "Toby.app is not running. Launch Toby.app to enable Apple Reminders tools.",
		});
	});

	it("lists the expected reminder tools", () => {
		const result = runPlugin(["tools", "list"]);
		expect(result.exitCode).toBe(0);
		const body = parseJson(result.stdout) as {
			ok: boolean;
			tools: Array<{ name: string; readOnly?: boolean }>;
		};
		expect(body.ok).toBe(true);
		expect(body.tools.map((tool) => tool.name)).toEqual([
			"listReminderLists",
			"searchReminders",
			"getReminder",
			"createReminder",
			"updateReminder",
			"completeReminder",
			"deleteReminder",
		]);
		expect(
			body.tools.find((tool) => tool.name === "searchReminders")?.readOnly,
		).toBe(true);
	});

	it("honors dryRun for write tools without calling native endpoints", () => {
		const result = runPlugin(["tools", "execute"], {
			stdin: {
				tool: "createReminder",
				input: { title: "Buy milk", dueDate: "2026-07-02T09:00:00" },
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
		expect(body.result.message).toContain('Would create reminder "Buy milk".');
	});

	it("connect fails clearly when Toby.app native access is unavailable", () => {
		tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "toby-applereminders-"));
		const result = runPlugin(["connect"], { home: tempHome });
		expect(result.exitCode).toBe(0);
		const body = parseJson(result.stdout);
		expect(body.ok).toBe(false);
		expect(body.reason).toBe(
			"Toby.app is not running. Launch Toby.app to connect Apple Reminders.",
		);
	});

	it("connect requests native Reminders access before validating lists", () => {
		tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "toby-applereminders-"));
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
  */api/native/reminders/request-access) printf '{"ok":true,"data":{"prompted":true}}' ;;
  */api/native/reminders/lists) printf '{"ok":true,"data":{"lists":[],"count":0}}' ;;
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
			reason: "Apple Reminders connected successfully.",
		});
		const calls = fs.readFileSync(callsFile, "utf8").trim().split("\n");
		expect(calls.some((call) => call.endsWith("/api/native/health"))).toBe(
			true,
		);
		expect(
			calls.some((call) =>
				call.endsWith("/api/native/reminders/request-access"),
			),
		).toBe(true);
		expect(
			calls.some((call) => call.endsWith("/api/native/reminders/lists")),
		).toBe(true);
		expect(
			calls.findIndex((call) =>
				call.endsWith("/api/native/reminders/request-access"),
			),
		).toBeLessThan(
			calls.findIndex((call) => call.endsWith("/api/native/reminders/lists")),
		);
	});

	it("core test connection does not mention credentials for no-config plugin", async () => {
		tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "toby-applereminders-"));
		const previousTobyDir = process.env.TOBY_DIR;
		try {
			process.env.TOBY_DIR = path.join(tempHome, "toby-home");
			const metadata = loadPluginMetadata({
				kind: "bun-package",
				directoryPath: pluginDir,
				binaryName: "toby-plugin-applereminders",
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
				"Apple Reminders is not connected. Run `toby connect applereminders` on this Mac.",
			);
		} finally {
			if (previousTobyDir === undefined) {
				Reflect.deleteProperty(process.env, "TOBY_DIR");
			} else {
				process.env.TOBY_DIR = previousTobyDir;
			}
		}
	});

	it("validates required tool input", () => {
		const result = runPlugin(["tools", "execute"], {
			stdin: {
				tool: "updateReminder",
				input: { id: "abc" },
				dryRun: true,
			},
		});
		expect(result.exitCode).toBe(0);
		const body = parseJson(result.stdout);
		expect(body.ok).toBe(false);
		expect(body.error).toBe("At least one field besides id is required.");
	});
});
