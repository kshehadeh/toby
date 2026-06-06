import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getHelpersDir } from "@toby/core/config/index";
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
	readonly child: ChildProcessWithoutNullStreams;
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

export interface TranscribeWithMacOSAudioHelperOptions {
	readonly input: string;
	readonly outDir: string;
	readonly whisperCli: string;
	readonly model: string;
	readonly language: string;
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

export function resolveAudioHelperPath(explicitPath?: string): string | null {
	const fromOption = explicitPath?.trim();
	if (fromOption) return fromOption;
	const fromEnv = process.env.TOBY_AUDIO_HELPER?.trim();
	if (fromEnv) return fromEnv;
	const executableDir = path.dirname(process.execPath);
	const candidates = [
		path.join(getHelpersDir(), "toby-listener"),
		path.join(executableDir, "toby-listener"),
		path.join(process.cwd(), "dist", "toby-listener"),
		path.join(process.cwd(), "dist", "toby-audio-helper"),
		path.join(
			process.cwd(),
			"helpers",
			"toby-audio-helper",
			".build",
			"release",
			"toby-audio-helper",
		),
		path.join(process.cwd(), "helpers", "toby-audio-helper"),
	];
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) return candidate;
	}
	return null;
}

export function parseAudioHelperEvent(line: string): AudioHelperEvent | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	try {
		const parsed = JSON.parse(trimmed) as Partial<AudioHelperEvent>;
		if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
			return null;
		}
		switch (parsed.type) {
			case "ready":
			case "status":
			case "permission":
			case "error":
			case "stopped":
			case "combined":
			case "transcribed":
				return parsed as AudioHelperEvent;
			default:
				return null;
		}
	} catch {
		return null;
	}
}

function helperArgs(session: ListenSession): string[] {
	const args = ["record", "--out-dir", session.tempDir, "--format", "wav"];
	for (const source of selectedListenSources(session.sources)) {
		args.push(source === "mic" ? "--mic" : "--system");
	}
	return args;
}

function combineArgs(options: CombineWithMacOSAudioHelperOptions): string[] {
	const args = ["combine", "--out-dir", options.outDir];
	if (options.mic) args.push("--mic", options.mic);
	if (options.system) args.push("--system", options.system);
	return args;
}

function transcribeArgs(options: TranscribeWithMacOSAudioHelperOptions): string[] {
	return [
		"transcribe",
		"--input",
		options.input,
		"--out-dir",
		options.outDir,
		"--whisper-cli",
		options.whisperCli,
		"--model",
		options.model,
		"--language",
		options.language,
	];
}

function requireAudioHelperPath(explicitPath?: string): string {
	const helperPath = resolveAudioHelperPath(explicitPath);
	if (!helperPath) {
		throw new ListenCaptureError(
			"helper_missing",
			"Audio helper not found. Set TOBY_AUDIO_HELPER or install the Swift helper described in docs/listen.md.",
		);
	}
	if (!fs.existsSync(helperPath)) {
		throw new ListenCaptureError(
			"helper_missing",
			`Audio helper does not exist at ${helperPath}.`,
		);
	}
	return helperPath;
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
	const helperPath = requireAudioHelperPath(options.helperPath);

	const child = spawn(helperPath, helperArgs(options.session), {
		stdio: ["pipe", "pipe", "pipe"],
	});

	let stdoutBuffer = "";
	child.stdout.on("data", (chunk) => {
		stdoutBuffer += chunk.toString("utf8");
		const lines = stdoutBuffer.split(/\r?\n/);
		stdoutBuffer = lines.pop() ?? "";
		for (const line of lines) {
			const event = parseAudioHelperEvent(line);
			if (event) options.onEvent?.(event);
		}
	});
	child.stderr.on("data", (chunk) => {
		const message = chunk.toString("utf8").trim();
		if (message) {
			options.onEvent?.({ type: "status", message });
		}
	});
	child.on("error", (error) => {
		options.onEvent?.({ type: "error", message: error.message });
	});

	return {
		helperPath,
		child,
		stop: async (action) => {
			if (child.killed) return;
			child.stdin.write(`${JSON.stringify({ type: "stop", action })}\n`);
			child.stdin.end();
		},
		dispose: () => {
			if (!child.killed) {
				child.kill("SIGTERM");
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
	const helperPath = requireAudioHelperPath(options.helperPath);
	const child = spawn(helperPath, combineArgs(options), {
		stdio: ["ignore", "pipe", "pipe"],
	});

	return new Promise((resolve, reject) => {
		let stdoutBuffer = "";
		let files: ListenRecordingFiles = {};
		const errors: string[] = [];
		child.stdout.on("data", (chunk) => {
			stdoutBuffer += chunk.toString("utf8");
			const lines = stdoutBuffer.split(/\r?\n/);
			stdoutBuffer = lines.pop() ?? "";
			for (const line of lines) {
				const event = parseAudioHelperEvent(line);
				if (!event) continue;
				options.onEvent?.(event);
				if ("files" in event && event.files) {
					files = { ...files, ...event.files };
				}
				if (event.type === "error") {
					errors.push(event.message);
				}
			}
		});
		child.stderr.on("data", (chunk) => {
			const message = chunk.toString("utf8").trim();
			if (message) {
				options.onEvent?.({ type: "status", message });
			}
		});
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) {
				resolve(files);
				return;
			}
			reject(
				new ListenCaptureError(
					"combine_failed",
					errors.at(-1) ??
						`Audio helper exited with status ${code ?? "unknown"}.`,
				),
			);
		});
	});
}

export function transcribeWithMacOSAudioHelper(
	options: TranscribeWithMacOSAudioHelperOptions,
): Promise<ListenRecordingFiles> {
	if (!isMacOSListenSupported()) {
		throw new ListenCaptureError(
			"unsupported_platform",
			"`toby listen transcribe` is currently supported on macOS only.",
		);
	}
	const helperPath = requireAudioHelperPath(options.helperPath);
	const child = spawn(helperPath, transcribeArgs(options), {
		stdio: ["ignore", "pipe", "pipe"],
	});

	return new Promise((resolve, reject) => {
		let stdoutBuffer = "";
		let files: ListenRecordingFiles = {};
		const errors: string[] = [];
		child.stdout.on("data", (chunk) => {
			stdoutBuffer += chunk.toString("utf8");
			const lines = stdoutBuffer.split(/\r?\n/);
			stdoutBuffer = lines.pop() ?? "";
			for (const line of lines) {
				const event = parseAudioHelperEvent(line);
				if (!event) continue;
				options.onEvent?.(event);
				if ("files" in event && event.files) {
					files = { ...files, ...event.files };
				}
				if (event.type === "error") {
					errors.push(event.message);
				}
			}
		});
		child.stderr.on("data", (chunk) => {
			const message = chunk.toString("utf8").trim();
			if (message) {
				options.onEvent?.({ type: "status", message });
			}
		});
		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) {
				resolve(files);
				return;
			}
			reject(
				new ListenCaptureError(
					"transcribe_failed",
					errors.at(-1) ??
						`Audio helper exited with status ${code ?? "unknown"}.`,
				),
			);
		});
	});
}

export function waitForAudioHelperExit(
	child: ChildProcessWithoutNullStreams,
	timeoutMs?: number,
): Promise<void> {
	if (child.exitCode !== null || child.killed) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		const timeout =
			timeoutMs === undefined
				? undefined
				: setTimeout(() => {
						if (!child.killed) {
							child.kill("SIGTERM");
						}
						resolve();
					}, timeoutMs);
		child.once("exit", () => {
			if (timeout) clearTimeout(timeout);
			resolve();
		});
	});
}
