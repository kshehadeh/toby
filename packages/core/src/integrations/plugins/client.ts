import { spawn, spawnSync } from "node:child_process";
import type {
	PluginActionResponse,
	PluginConfigEnvelope,
	PluginConfigGetResponse,
	PluginConfigShapeResponse,
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

export type PluginInvokeResult<T> =
	| { readonly ok: true; readonly data: T; readonly stderr: string }
	| {
			readonly ok: false;
			readonly error: string;
			readonly code: string;
			readonly stderr: string;
			readonly exitCode: number | null;
	  };

const DEFAULT_TIMEOUT_MS = 25_000;
const DEFAULT_MAX_BUFFER = 4 * 1024 * 1024;

function serializeEnvelope(envelope: PluginConfigEnvelope = {}): string {
	const payload: Record<string, unknown> = {
		config: envelope.config ?? {},
		state: envelope.state ?? {},
	};
	if (envelope.validateTools) {
		payload.validateTools = true;
	}
	return JSON.stringify(payload);
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
	binaryPath: string,
	args: string[],
	input?: string,
	options: PluginClientOptions = {},
): PluginInvokeResult<T> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxBuffer = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER;

	const result = spawnSync(binaryPath, args, {
		encoding: "utf8",
		timeout: timeoutMs,
		maxBuffer,
		input,
	});

	const stderr = typeof result.stderr === "string" ? result.stderr : "";

	if (result.error) {
		return {
			ok: false,
			error: result.error.message,
			code: "spawn_error",
			stderr: stderr.trim(),
			exitCode: result.status,
		};
	}

	const stdout = typeof result.stdout === "string" ? result.stdout : "";
	return interpretPluginOutput<T>(stdout, stderr, result.status);
}

function invokePluginAsync<T>(
	binaryPath: string,
	args: string[],
	input?: string,
	options: PluginClientOptions = {},
): Promise<PluginInvokeResult<T>> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxBuffer = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER;

	return new Promise((resolve) => {
		const child = spawn(binaryPath, args, { stdio: ["pipe", "pipe", "pipe"] });
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
	binaryPath: string,
	envelope: PluginConfigEnvelope = {},
	options?: PluginClientOptions,
): PluginInvokeResult<PluginStatusResponse> {
	return invokePlugin<PluginStatusResponse>(
		binaryPath,
		["status"],
		serializeEnvelope(envelope),
		options,
	);
}

export function pluginStatusAsync(
	binaryPath: string,
	envelope: PluginConfigEnvelope = {},
	options?: PluginClientOptions,
): Promise<PluginInvokeResult<PluginStatusResponse>> {
	return invokePluginAsync<PluginStatusResponse>(
		binaryPath,
		["status"],
		serializeEnvelope(envelope),
		options,
	);
}

export function pluginConnect(
	binaryPath: string,
	envelope: PluginConfigEnvelope,
	options?: PluginClientOptions,
): PluginInvokeResult<PluginActionResponse> {
	return invokePlugin<PluginActionResponse>(
		binaryPath,
		["connect"],
		serializeEnvelope(envelope),
		options,
	);
}

export function pluginDisconnect(
	binaryPath: string,
	envelope: PluginConfigEnvelope = {},
	options?: PluginClientOptions,
): PluginInvokeResult<PluginActionResponse> {
	return invokePlugin<PluginActionResponse>(
		binaryPath,
		["disconnect"],
		serializeEnvelope(envelope),
		options,
	);
}

export function pluginConfigShape(
	binaryPath: string,
	options?: PluginClientOptions,
): PluginInvokeResult<PluginConfigShapeResponse> {
	return invokePlugin<PluginConfigShapeResponse>(
		binaryPath,
		["config", "shape"],
		undefined,
		options,
	);
}

export function pluginConfigGet(
	binaryPath: string,
	envelope: PluginConfigEnvelope,
	options?: PluginClientOptions,
): PluginInvokeResult<PluginConfigGetResponse> {
	return invokePlugin<PluginConfigGetResponse>(
		binaryPath,
		["config", "get"],
		serializeEnvelope(envelope),
		options,
	);
}

export function pluginConfigSet(
	binaryPath: string,
	envelope: PluginConfigEnvelope,
	options?: PluginClientOptions,
): PluginInvokeResult<PluginActionResponse> {
	return invokePlugin<PluginActionResponse>(
		binaryPath,
		["config", "set"],
		serializeEnvelope(envelope),
		options,
	);
}

export function pluginToolsList(
	binaryPath: string,
	options?: PluginClientOptions,
): PluginInvokeResult<PluginToolsListResponse> {
	return invokePlugin<PluginToolsListResponse>(
		binaryPath,
		["tools", "list"],
		undefined,
		options,
	);
}

function serializeToolExecuteRequest(
	request: PluginToolExecuteRequest,
): string {
	return JSON.stringify({
		tool: request.tool,
		input: request.input ?? {},
		config: request.config ?? {},
		state: request.state ?? {},
		dryRun: request.dryRun ?? false,
	});
}

export function pluginToolsExecute(
	binaryPath: string,
	request: PluginToolExecuteRequest,
	options?: PluginClientOptions,
): PluginInvokeResult<PluginToolExecuteResponse> {
	return invokePlugin<PluginToolExecuteResponse>(
		binaryPath,
		["tools", "execute"],
		serializeToolExecuteRequest(request),
		options,
	);
}

export function pluginToolsExecuteAsync(
	binaryPath: string,
	request: PluginToolExecuteRequest,
	options?: PluginClientOptions,
): Promise<PluginInvokeResult<PluginToolExecuteResponse>> {
	return invokePluginAsync<PluginToolExecuteResponse>(
		binaryPath,
		["tools", "execute"],
		serializeToolExecuteRequest(request),
		options,
	);
}

export function pluginSetup(
	binaryPath: string,
	envelope: PluginConfigEnvelope = {},
	options?: PluginClientOptions,
): PluginInvokeResult<PluginSetupResponse> {
	return invokePlugin<PluginSetupResponse>(
		binaryPath,
		["setup"],
		serializeEnvelope(envelope),
		options,
	);
}

export function pluginSetupGuide(
	binaryPath: string,
	envelope: PluginConfigEnvelope = {},
	options?: PluginClientOptions,
): PluginInvokeResult<PluginSetupGuideResponse> {
	return invokePlugin<PluginSetupGuideResponse>(
		binaryPath,
		["setup", "guide"],
		serializeEnvelope(envelope),
		options,
	);
}
