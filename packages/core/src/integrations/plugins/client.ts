import { spawn, spawnSync } from "node:child_process";
import type {
	PluginActionResponse,
	PluginConfigEnvelope,
	PluginConfigGetResponse,
	PluginConfigShapeResponse,
	PluginEventsPollResponse,
	PluginInvocationTarget,
	PluginSetupGuideResponse,
	PluginSetupResponse,
	PluginStatusResponse,
	PluginToolExecuteRequest,
	PluginToolExecuteResponse,
	PluginToolsListResponse,
} from "./protocol";

export type PluginClientOptions = {
	readonly timeoutMs?: number;
	readonly maxBufferBytes?: number;
};

/**
 * Accepts either a proper `PluginInvocationTarget` or a plain string path
 * (treated as a binary executable path, for backward compatibility).
 */
export type PluginTargetParam = PluginInvocationTarget | string;

function normalizeTarget(target: PluginTargetParam): PluginInvocationTarget {
	if (typeof target === "string") {
		return { kind: "binary", executablePath: target };
	}
	return target;
}

export type PluginInvokeResult<T> =
	| { readonly ok: true; readonly data: T; readonly stderr: string }
	| {
			readonly ok: false;
			readonly error: string;
			readonly code: string;
			readonly stderr: string;
			readonly exitCode: number | null;
	  };

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BUFFER = 4 * 1024 * 1024;

function serializeEnvelope(envelope: PluginConfigEnvelope = {}): string {
	const payload: Record<string, unknown> = {
		config: envelope.config ?? {},
		state: envelope.state ?? {},
	};
	if (envelope.validateTools) {
		payload.validateTools = true;
	}
	if (envelope.paths?.dataDir) {
		payload.paths = { dataDir: envelope.paths.dataDir };
	}
	return JSON.stringify(payload);
}

/**
 * Convert a `PluginInvocationTarget` into the command/args/cwd needed for
 * `spawnSync` or `spawn`.
 */
function resolveSpawnCommand(
	target: PluginInvocationTarget,
	pluginArgs: string[],
): { command: string; args: string[]; cwd?: string } {
	if (target.kind === "binary") {
		return { command: target.executablePath, args: pluginArgs };
	}
	return {
		command: target.bunPath,
		args: ["run", target.entryPath, ...pluginArgs],
		cwd: target.cwd,
	};
}

function interpretPluginOutput<T>(
	stdout: string,
	stderr: string,
	exitCode: number | null,
): PluginInvokeResult<T> {
	const trimmedStderr = stderr.trim();
	const trimmedStdout = stdout.trim();

	if (!trimmedStdout) {
		return {
			ok: false,
			error: "Plugin returned empty stdout",
			code: "empty_output",
			stderr: trimmedStderr,
			exitCode,
		};
	}

	let parsed: T;
	try {
		parsed = JSON.parse(trimmedStdout) as T;
	} catch {
		return {
			ok: false,
			error: `Plugin returned non-JSON stdout: ${trimmedStdout.slice(0, 500)}`,
			code: "parse_error",
			stderr: trimmedStderr,
			exitCode,
		};
	}

	if (exitCode === 2) {
		const payload = parsed as { error?: string; code?: string };
		return {
			ok: false,
			error: payload.error ?? "Plugin contract error",
			code: payload.code ?? "contract_error",
			stderr: trimmedStderr,
			exitCode,
		};
	}

	return { ok: true, data: parsed, stderr: trimmedStderr };
}

function invokePlugin<T>(
	target: PluginTargetParam,
	args: string[],
	input?: string,
	options: PluginClientOptions = {},
): PluginInvokeResult<T> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxBuffer = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER;

	const {
		command,
		args: spawnArgs,
		cwd,
	} = resolveSpawnCommand(normalizeTarget(target), args);

	const result = spawnSync(command, spawnArgs, {
		encoding: "utf8",
		timeout: timeoutMs,
		maxBuffer,
		input,
		...(cwd ? { cwd } : {}),
	});

	const stderr = typeof result.stderr === "string" ? result.stderr : "";

	if (result.error) {
		const message = result.error.message;
		// Common after rebuilding plugins in place: a stale binary target still
		// points at a directory path. Surface a clearer recovery hint.
		const looksLikeDirSpawn =
			/EACCES|EISDIR|permission denied/i.test(message) &&
			!command.includes("bun");
		return {
			ok: false,
			error: looksLikeDirSpawn
				? `${message}. This path looks like a bun-package plugin directory being spawned as a binary — restart the daemon or rebuild plugins with \`bun run build:plugins\`.`
				: message,
			code: "spawn_error",
			stderr: stderr.trim(),
			exitCode: result.status,
		};
	}

	const stdout = typeof result.stdout === "string" ? result.stdout : "";
	return interpretPluginOutput<T>(stdout, stderr, result.status);
}

function invokePluginAsync<T>(
	target: PluginTargetParam,
	args: string[],
	input?: string,
	options: PluginClientOptions = {},
): Promise<PluginInvokeResult<T>> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxBuffer = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER;

	const {
		command,
		args: spawnArgs,
		cwd,
	} = resolveSpawnCommand(normalizeTarget(target), args);

	return new Promise((resolve) => {
		const child = spawn(command, spawnArgs, {
			stdio: ["pipe", "pipe", "pipe"],
			...(cwd ? { cwd } : {}),
		});
		let stdout = "";
		let stderr = "";
		let settled = false;

		const settle = (result: PluginInvokeResult<T>) => {
			if (settled) return;
			settled = true;
			if (timeout) clearTimeout(timeout);
			resolve(result);
		};

		let timeout: ReturnType<typeof setTimeout> | undefined;
		if (timeoutMs > 0) {
			timeout = setTimeout(() => {
				child.kill();
				settle({
					ok: false,
					error: "spawn ETIMEDOUT",
					code: "spawn_error",
					stderr: stderr.trim(),
					exitCode: null,
				});
			}, timeoutMs);
		}

		child.stdout?.on("data", (chunk: Buffer | string) => {
			stdout += chunk.toString();
			if (stdout.length > maxBuffer) {
				child.kill();
				settle({
					ok: false,
					error: "maxBuffer exceeded",
					code: "spawn_error",
					stderr: stderr.trim(),
					exitCode: null,
				});
			}
		});

		child.stderr?.on("data", (chunk: Buffer | string) => {
			stderr += chunk.toString();
		});

		if (input !== undefined) {
			child.stdin?.write(input);
		}
		child.stdin?.end();

		child.on("error", (error) => {
			settle({
				ok: false,
				error: error.message,
				code: "spawn_error",
				stderr: stderr.trim(),
				exitCode: null,
			});
		});

		child.on("close", (code) => {
			settle(interpretPluginOutput<T>(stdout, stderr, code));
		});
	});
}

export function pluginStatus(
	target: PluginTargetParam,
	envelope: PluginConfigEnvelope = {},
	options?: PluginClientOptions,
): PluginInvokeResult<PluginStatusResponse> {
	return invokePlugin<PluginStatusResponse>(
		target,
		["status"],
		serializeEnvelope(envelope),
		options,
	);
}

export function pluginStatusAsync(
	target: PluginTargetParam,
	envelope: PluginConfigEnvelope = {},
	options?: PluginClientOptions,
): Promise<PluginInvokeResult<PluginStatusResponse>> {
	return invokePluginAsync<PluginStatusResponse>(
		target,
		["status"],
		serializeEnvelope(envelope),
		options,
	);
}

export function pluginConnect(
	target: PluginTargetParam,
	envelope: PluginConfigEnvelope,
	options?: PluginClientOptions,
): PluginInvokeResult<PluginActionResponse> {
	return invokePlugin<PluginActionResponse>(
		target,
		["connect"],
		serializeEnvelope(envelope),
		options,
	);
}

export function pluginDisconnect(
	target: PluginTargetParam,
	envelope: PluginConfigEnvelope = {},
	options?: PluginClientOptions,
): PluginInvokeResult<PluginActionResponse> {
	return invokePlugin<PluginActionResponse>(
		target,
		["disconnect"],
		serializeEnvelope(envelope),
		options,
	);
}

export function pluginConfigShape(
	target: PluginTargetParam,
	options?: PluginClientOptions,
): PluginInvokeResult<PluginConfigShapeResponse> {
	return invokePlugin<PluginConfigShapeResponse>(
		target,
		["config", "shape"],
		undefined,
		options,
	);
}

export function pluginConfigGet(
	target: PluginTargetParam,
	envelope: PluginConfigEnvelope,
	options?: PluginClientOptions,
): PluginInvokeResult<PluginConfigGetResponse> {
	return invokePlugin<PluginConfigGetResponse>(
		target,
		["config", "get"],
		serializeEnvelope(envelope),
		options,
	);
}

export function pluginConfigSet(
	target: PluginTargetParam,
	envelope: PluginConfigEnvelope,
	options?: PluginClientOptions,
): PluginInvokeResult<PluginActionResponse> {
	return invokePlugin<PluginActionResponse>(
		target,
		["config", "set"],
		serializeEnvelope(envelope),
		options,
	);
}

export function pluginToolsList(
	target: PluginTargetParam,
	options?: PluginClientOptions,
): PluginInvokeResult<PluginToolsListResponse> {
	return invokePlugin<PluginToolsListResponse>(
		target,
		["tools", "list"],
		undefined,
		options,
	);
}

function serializeToolExecuteRequest(
	request: PluginToolExecuteRequest,
): string {
	const payload: Record<string, unknown> = {
		tool: request.tool,
		input: request.input ?? {},
		config: request.config ?? {},
		state: request.state ?? {},
		dryRun: request.dryRun ?? false,
	};
	if (request.paths?.dataDir) {
		payload.paths = { dataDir: request.paths.dataDir };
	}
	return JSON.stringify(payload);
}

export function pluginToolsExecute(
	target: PluginTargetParam,
	request: PluginToolExecuteRequest,
	options?: PluginClientOptions,
): PluginInvokeResult<PluginToolExecuteResponse> {
	return invokePlugin<PluginToolExecuteResponse>(
		target,
		["tools", "execute"],
		serializeToolExecuteRequest(request),
		options,
	);
}

export function pluginToolsExecuteAsync(
	target: PluginTargetParam,
	request: PluginToolExecuteRequest,
	options?: PluginClientOptions,
): Promise<PluginInvokeResult<PluginToolExecuteResponse>> {
	return invokePluginAsync<PluginToolExecuteResponse>(
		target,
		["tools", "execute"],
		serializeToolExecuteRequest(request),
		options,
	);
}

export function pluginSetup(
	target: PluginTargetParam,
	envelope: PluginConfigEnvelope = {},
	options?: PluginClientOptions,
): PluginInvokeResult<PluginSetupResponse> {
	return invokePlugin<PluginSetupResponse>(
		target,
		["setup"],
		serializeEnvelope(envelope),
		options,
	);
}

export function pluginSetupGuide(
	target: PluginTargetParam,
	envelope: PluginConfigEnvelope = {},
	options?: PluginClientOptions,
): PluginInvokeResult<PluginSetupGuideResponse> {
	return invokePlugin<PluginSetupGuideResponse>(
		target,
		["setup", "guide"],
		serializeEnvelope(envelope),
		options,
	);
}

export function pluginEventsPoll(
	target: PluginTargetParam,
	envelope: PluginConfigEnvelope = {},
	options?: PluginClientOptions,
): PluginInvokeResult<PluginEventsPollResponse> {
	return invokePlugin<PluginEventsPollResponse>(
		target,
		["events", "poll"],
		serializeEnvelope(envelope),
		options,
	);
}

export function pluginEventsPollAsync(
	target: PluginTargetParam,
	envelope: PluginConfigEnvelope = {},
	options?: PluginClientOptions,
): Promise<PluginInvokeResult<PluginEventsPollResponse>> {
	return invokePluginAsync<PluginEventsPollResponse>(
		target,
		["events", "poll"],
		serializeEnvelope(envelope),
		options,
	);
}
