import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

export type NativeResponse = {
	ok: boolean;
	data?: JsonRecord;
	error?: string;
	needsPermission?: boolean;
};

const TIMEOUT_MS = 30_000;
const LAUNCH_RETRY_DELAY_MS = 1_000;
const MAX_LAUNCH_RETRIES = 8;

/** Matches CLI/core `resolveTobyDir()` so native discovery works with TOBY_DIR. */
function resolveTobyDir(): string {
	const override = process.env.TOBY_DIR?.trim();
	if (override) return override;
	return path.join(os.homedir(), ".toby");
}

function resolveNativePort(): number | null {
	const portFile = path.join(resolveTobyDir(), "native-port");
	try {
		const text = fs.readFileSync(portFile, "utf8").trim();
		const port = Number.parseInt(text, 10);
		return Number.isNaN(port) ? null : port;
	} catch {
		return null;
	}
}

function checkHealth(): boolean {
	const port = resolveNativePort();
	if (!port) return false;
	try {
		const result = spawnSync("curl", [
			"-s",
			"-o",
			"/dev/null",
			"-w",
			"%{http_code}",
			"--max-time",
			"2",
			`http://127.0.0.1:${port}/api/native/health`,
		]);
		return result.stdout.toString().trim() === "200";
	} catch {
		return false;
	}
}

export function isNativeAvailable(): boolean {
	return checkHealth();
}

function resolveTobyAppPath(): string | null {
	const home = os.homedir();

	const envPath = process.env.TOBY_APP_PATH;
	if (envPath && fs.existsSync(envPath)) return envPath;

	for (const devName of ["Toby (Dev).app", "Toby.app"]) {
		const devPath = path.join(home, "dev/karim/toby/dist", devName);
		if (fs.existsSync(devPath)) return devPath;
	}

	const installDir = path.join(home, ".local/bin/Toby.app");
	if (fs.existsSync(installDir)) return installDir;

	const systemApplications = "/Applications/Toby.app";
	if (fs.existsSync(systemApplications)) return systemApplications;

	const userApplications = path.join(home, "Applications/Toby.app");
	if (fs.existsSync(userApplications)) return userApplications;

	return null;
}

function ensureAvailable(): boolean {
	if (checkHealth()) return true;

	const appPath = resolveTobyAppPath();
	if (!appPath) return false;

	try {
		spawnSync("/usr/bin/open", ["-g", appPath], {
			stdio: "ignore",
		});
	} catch {
		return false;
	}

	for (let i = 0; i < MAX_LAUNCH_RETRIES; i++) {
		const msecs = LAUNCH_RETRY_DELAY_MS;
		const start = Date.now();
		while (Date.now() - start < msecs) {
			// busy wait — Bun has no synchronous sleep
		}
		if (checkHealth()) return true;
	}
	return false;
}

export function nativeRequest(
	endpoint: string,
	body?: JsonRecord,
): NativeResponse {
	const port = resolveNativePort();
	if (!port || !checkHealth()) {
		ensureAvailable();
	}

	const resolvedPort = resolveNativePort();
	if (!resolvedPort) {
		return {
			ok: false,
			error:
				"Toby.app native server not found. Install Toby.app and launch it.",
		};
	}

	const url = `http://127.0.0.1:${resolvedPort}/api/native/${endpoint}`;
	const args = [
		"-s",
		"--max-time",
		String(Math.round(TIMEOUT_MS / 1000)),
		"-X",
		"POST",
		"-H",
		"Content-Type: application/json",
	];

	if (body) {
		args.push("-d", JSON.stringify(body));
	}
	args.push(url);

	try {
		const result = spawnSync("curl", args, {
			encoding: "utf8",
			timeout: TIMEOUT_MS,
			maxBuffer: 4 * 1024 * 1024,
		});

		if (result.error) {
			return {
				ok: false,
				error: `Native server request failed: ${result.error.message}`,
			};
		}

		const stdout = (result.stdout ?? "").trim();
		if (!stdout) {
			return {
				ok: false,
				error: "Native server returned empty response.",
			};
		}

		const json = JSON.parse(stdout) as {
			ok?: boolean;
			data?: JsonRecord;
			error?: string;
			needsPermission?: boolean;
		};

		return {
			ok: json.ok ?? false,
			data: json.data,
			error: json.error,
			needsPermission: json.needsPermission,
		};
	} catch (error) {
		return {
			ok: false,
			error: `Native server request failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}
