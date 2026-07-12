import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveTobyDir } from "../config/index";

export type NativeAppResponse = {
	readonly ok: boolean;
	readonly data?: Record<string, unknown>;
	readonly error?: string;
	readonly needsPermission?: boolean;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const LAUNCH_POLL_MS = 1_000;
const LAUNCH_MAX_ATTEMPTS = 30;

function resolveTobyAppPath(): string | null {
	const env = process.env.TOBY_APP_PATH?.trim();
	if (env && fs.existsSync(env)) return env;
	const home = os.homedir();
	const candidates = [
		path.join(home, "dev/karim/toby/dist/Toby (Dev).app"),
		path.join(home, "dev/karim/toby/dist/Toby.app"),
		path.join(home, ".local/bin/Toby.app"),
		"/Applications/Toby.app",
		path.join(home, "Applications/Toby.app"),
		path.join(process.cwd(), "dist/Toby (Dev).app"),
		path.join(process.cwd(), "dist/Toby.app"),
	];
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) return candidate;
	}
	return null;
}

export function resolveNativePort(): number | null {
	const portFile = path.join(resolveTobyDir(), "native-port");
	try {
		const text = fs.readFileSync(portFile, "utf8").trim();
		const port = Number.parseInt(text, 10);
		return Number.isNaN(port) ? null : port;
	} catch {
		return null;
	}
}

export async function isNativeServerAlive(port: number): Promise<boolean> {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/api/native/health`, {
			signal: AbortSignal.timeout(1_000),
		});
		return res.ok;
	} catch {
		return false;
	}
}

async function launchTobyApp(): Promise<number> {
	const appPath = resolveTobyAppPath();
	if (!appPath) {
		throw new Error(
			"Toby.app not found. Install Toby.app or set TOBY_APP_PATH.",
		);
	}
	spawn("open", ["-g", appPath], { detached: true, stdio: "ignore" });
	for (let i = 0; i < LAUNCH_MAX_ATTEMPTS; i++) {
		await new Promise((resolve) => setTimeout(resolve, LAUNCH_POLL_MS));
		const port = resolveNativePort();
		if (port && (await isNativeServerAlive(port))) {
			return port;
		}
	}
	throw new Error("Toby.app native server did not become available.");
}

/**
 * Ensure Toby.app's native HTTP server is reachable, auto-launching the app
 * when needed. Returns the localhost port.
 */
export async function ensureNativeServer(): Promise<number> {
	const port = resolveNativePort();
	if (port && (await isNativeServerAlive(port))) {
		return port;
	}
	return launchTobyApp();
}

/**
 * POST (or other method) to a Toby.app `/api/native/<endpoint>` route.
 * Auto-launches Toby.app when the native server is not yet up.
 */
export async function nativeAppRequest(
	endpoint: string,
	options?: {
		readonly method?: string;
		readonly body?: Record<string, unknown>;
		readonly timeoutMs?: number;
	},
): Promise<NativeAppResponse> {
	const method = options?.method ?? "POST";
	const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	let port: number;
	try {
		port = await ensureNativeServer();
	} catch (error) {
		return {
			ok: false,
			error:
				error instanceof Error
					? error.message
					: "Toby.app native server is unavailable.",
		};
	}

	const url = `http://127.0.0.1:${port}/api/native/${endpoint.replace(/^\//, "")}`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, {
			method,
			headers: options?.body
				? { "Content-Type": "application/json" }
				: undefined,
			body: options?.body ? JSON.stringify(options.body) : undefined,
			signal: controller.signal,
		});
		const json = (await res.json()) as {
			ok?: boolean;
			data?: Record<string, unknown>;
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
		if (error instanceof Error && error.name === "AbortError") {
			return {
				ok: false,
				error: `Native server request timed out after ${timeoutMs}ms.`,
			};
		}
		return {
			ok: false,
			error:
				error instanceof Error
					? error.message
					: "Native server request failed.",
		};
	} finally {
		clearTimeout(timer);
	}
}
