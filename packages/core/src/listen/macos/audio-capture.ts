import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveTobyDir } from "../../config/index";
import type { ListenRecordingFiles, ListenSession } from "../types";
import { selectedListenSources } from "../types";

export type AudioHelperEvent =
	| {
			readonly type: "ready";
			readonly helperVersion?: string;
			readonly files?: ListenRecordingFiles;
	  }
	| {
			readonly type: "status";
			readonly message: string;
	  }
	| {
			readonly type: "permission";
			readonly service: "microphone" | "screen" | "systemAudio";
			readonly status: "granted" | "denied" | "prompting" | "unknown";
			readonly message?: string;
	  }
	| {
			readonly type: "error";
			readonly code?: string;
			readonly message: string;
	  }
	| {
			readonly type: "stopped";
			readonly files?: ListenRecordingFiles;
			readonly durationMs?: number;
	  }
	| {
			readonly type: "combined";
			readonly files?: ListenRecordingFiles;
	  }
	| {
			readonly type: "transcribed";
			readonly files?: ListenRecordingFiles;
	  };

export interface AudioCaptureHandle {
	readonly helperPath: string;
	stop(action: "save" | "discard"): Promise<void>;
	dispose(): void;
}

export interface StartMacOSAudioCaptureOptions {
	readonly session: ListenSession;
	readonly helperPath?: string;
	readonly onEvent?: (event: AudioHelperEvent) => void;
}

export interface CombineWithMacOSAudioHelperOptions {
	readonly outDir: string;
	readonly mic?: string;
	readonly system?: string;
	readonly helperPath?: string;
	readonly onEvent?: (event: AudioHelperEvent) => void;
}

export class ListenCaptureError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "ListenCaptureError";
		this.code = code;
	}
}

function isMacOSListenSupported(): boolean {
	return process.platform === "darwin";
}

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

function resolveNativePort(): number | null {
	const portFile = path.join(resolveTobyDir(), "native-port");
	if (!fs.existsSync(portFile)) return null;
	const text = fs.readFileSync(portFile, "utf8").trim();
	const port = Number.parseInt(text, 10);
	return Number.isNaN(port) ? null : port;
}

async function isNativeServerAlive(port: number): Promise<boolean> {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/api/native/health`, {
			signal: AbortSignal.timeout(1000),
		});
		return res.ok;
	} catch {
		return false;
	}
}

async function launchTobyApp(): Promise<number> {
	const appPath = resolveTobyAppPath();
	if (!appPath) {
		throw new ListenCaptureError(
			"app_missing",
			"Toby.app not found. Set TOBY_APP_PATH or install the app.",
		);
	}
	spawn("open", [appPath], { detached: true });
	for (let i = 0; i < 30; i++) {
		await new Promise((resolve) => setTimeout(resolve, 1000));
		const port = resolveNativePort();
		if (port && (await isNativeServerAlive(port))) {
			return port;
		}
	}
	throw new ListenCaptureError(
		"app_not_ready",
		"Toby.app native server did not become available.",
	);
}

async function ensureNativeServer(): Promise<number> {
	const port = resolveNativePort();
	if (port && (await isNativeServerAlive(port))) {
		return port;
	}
	return launchTobyApp();
}

async function nativeRequest(
	endpoint: string,
	method: string,
	body?: Record<string, unknown>,
): Promise<unknown> {
	const port = await ensureNativeServer();
	const url = `http://127.0.0.1:${port}/api/native/${endpoint}`;
	const res = await fetch(url, {
		method,
		headers: body ? { "Content-Type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!res.ok) {
		throw new ListenCaptureError(
			"server_error",
			`Native server returned ${res.status}`,
		);
	}
	const data = (await res.json()) as {
		ok: boolean;
		data?: unknown;
		error?: string;
	};
	if (!data.ok) {
		throw new ListenCaptureError(
			"native_error",
			data.error ?? "Native server request failed",
		);
	}
	return data.data;
}

export function resolveAudioHelperPath(_explicitPath?: string): string | null {
	// Deprecated: audio-helper (toby-listener) has been removed. Toby.app is the
	// only supported audio capture path. This function is kept for compatibility
	// with existing callers that may pass a helper path.
	return null;
}

export function parseAudioHelperEvent(_line: string): AudioHelperEvent | null {
	// Deprecated: events are no longer parsed from stdout. Kept for compatibility.
	return null;
}

export function startMacOSAudioCapture(
	options: StartMacOSAudioCaptureOptions,
): AudioCaptureHandle {
	if (!isMacOSListenSupported()) {
		throw new ListenCaptureError(
			"unsupported_platform",
			"`toby listen` audio capture is currently supported on macOS only.",
		);
	}
	const appPath = resolveTobyAppPath();
	if (!appPath) {
		throw new ListenCaptureError(
			"app_missing",
			"Toby.app not found. Set TOBY_APP_PATH or install the app.",
		);
	}

	let running = false;
	let stopPromise: Promise<void> | null = null;
	const onEvent = options.onEvent;

	const startPromise = (async () => {
		try {
			const sources = selectedListenSources(options.session.sources);
			const data = (await nativeRequest("audio/start", "POST", {
				mic: sources.includes("mic"),
				system: sources.includes("system"),
			})) as {
				status: string;
				message?: string;
				session?: { id: string; sources: { mic: boolean; system: boolean } };
				outputDir?: string;
			};
			running = true;
			onEvent?.({
				type: "ready",
				helperVersion: "toby-app",
				files: {},
			});
			onEvent?.({
				type: "status",
				message: data.message ?? "Recording.",
			});
		} catch (error) {
			onEvent?.({
				type: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	})();

	const stop = async (action: "save" | "discard"): Promise<void> => {
		await startPromise;
		if (!running && !stopPromise) return;
		if (stopPromise) return stopPromise;
		stopPromise = (async () => {
			try {
				const data = (await nativeRequest("audio/stop", "POST", {
					action,
				})) as {
					status: string;
					message?: string;
					id?: string;
					outputDir?: string;
					files?: ListenRecordingFiles;
					errors?: string[];
				};
				running = false;
				if (action !== "discard") {
					onEvent?.({ type: "stopped", files: data.files });
				}
				onEvent?.({
					type: "status",
					message: data.message ?? "Recording stopped.",
				});
			} catch (error) {
				running = false;
				onEvent?.({
					type: "error",
					message: error instanceof Error ? error.message : String(error),
				});
				throw error;
			}
		})();
		return stopPromise;
	};

	return {
		helperPath: appPath,
		stop,
		dispose: () => {
			if (running || stopPromise) {
				void stop("discard");
			}
		},
	};
}

export function combineWithMacOSAudioHelper(
	options: CombineWithMacOSAudioHelperOptions,
): Promise<ListenRecordingFiles> {
	if (!isMacOSListenSupported()) {
		throw new ListenCaptureError(
			"unsupported_platform",
			"`toby listen transcribe` is currently supported on macOS only.",
		);
	}
	return (async () => {
		const data = (await nativeRequest("audio/combine", "POST", {
			outDir: options.outDir,
			mic: options.mic,
			system: options.system,
		})) as { combined?: string };
		const files: ListenRecordingFiles = data.combined
			? { combined: data.combined }
			: {};
		return files;
	})();
}

export function waitForAudioHelperExit(): Promise<void> {
	// Deprecated: no child process to wait for. Kept for compatibility.
	return Promise.resolve();
}
