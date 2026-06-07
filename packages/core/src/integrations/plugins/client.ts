import { spawnSync } from "node:child_process";
import type {
	PluginActionResponse,
	PluginConfigEnvelope,
	PluginConfigGetResponse,
	PluginConfigShapeResponse,
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

	const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";

	if (result.error) {
		return {
			ok: false,
			error: result.error.message,
			code: "spawn_error",
			stderr,
			exitCode: result.status,
		};
	}

	const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
	if (!stdout) {
		return {
			ok: false,
			error: "Plugin returned empty stdout",
			code: "empty_output",
			stderr,
			exitCode: result.status,
		};
	}

	let parsed: T;
	try {
		parsed = JSON.parse(stdout) as T;
	} catch {
		return {
			ok: false,
			error: `Plugin returned non-JSON stdout: ${stdout.slice(0, 500)}`,
			code: "parse_error",
			stderr,
			exitCode: result.status,
		};
	}

	if (result.status === 2) {
		const payload = parsed as { error?: string; code?: string };
		return {
			ok: false,
			error: payload.error ?? "Plugin contract error",
			code: payload.code ?? "contract_error",
			stderr,
			exitCode: result.status,
		};
	}

	return { ok: true, data: parsed, stderr };
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

export function pluginToolsExecute(
	binaryPath: string,
	request: PluginToolExecuteRequest,
	options?: PluginClientOptions,
): PluginInvokeResult<PluginToolExecuteResponse> {
	return invokePlugin<PluginToolExecuteResponse>(
		binaryPath,
		["tools", "execute"],
		JSON.stringify({
			tool: request.tool,
			input: request.input ?? {},
			config: request.config ?? {},
			state: request.state ?? {},
			dryRun: request.dryRun ?? false,
		}),
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
