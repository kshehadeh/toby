import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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
			readonly service: "microphone" | "screen" | "speech" | "systemAudio";
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

export class ListenCaptureError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "ListenCaptureError";
		this.code = code;
	}
}

export function isMacOSListenSupported(): boolean {
	return process.platform === "darwin";
}

export function resolveAudioHelperPath(explicitPath?: string): string | null {
	const fromOption = explicitPath?.trim();
	if (fromOption) return fromOption;
	const fromEnv = process.env.TOBY_AUDIO_HELPER?.trim();
	if (fromEnv) return fromEnv;
	const candidates = [
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

export function startMacOSAudioCapture(
	options: StartMacOSAudioCaptureOptions,
): AudioCaptureHandle {
	if (!isMacOSListenSupported()) {
		throw new ListenCaptureError(
			"unsupported_platform",
			"`toby listen` audio capture is currently supported on macOS only.",
		);
	}
	const helperPath = resolveAudioHelperPath(options.helperPath);
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

export function waitForAudioHelperExit(
	child: ChildProcessWithoutNullStreams,
	timeoutMs = 5_000,
): Promise<void> {
	if (child.exitCode !== null || child.killed) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		const timeout = setTimeout(() => {
			if (!child.killed) {
				child.kill("SIGTERM");
			}
			resolve();
		}, timeoutMs);
		child.once("exit", () => {
			clearTimeout(timeout);
			resolve();
		});
	});
}
