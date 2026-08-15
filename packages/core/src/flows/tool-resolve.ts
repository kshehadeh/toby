import {
	type CredentialsFile,
	ensurePluginDataDir,
	getDefaultProvider,
	readConfig,
	readCredentials,
} from "../config/index";
import { STANDARD_TOOL_FOR_CATEGORY } from "../dashboard/types";
import { getIntegrationModules } from "../integrations/index";
import { forwardPluginStderr } from "../integrations/plugins/adapter";
import {
	pluginToolsExecuteAsync,
	pluginToolsList,
} from "../integrations/plugins/client";
import type { PluginToolsListResponse } from "../integrations/plugins/protocol";
import { getPluginMetadata } from "../integrations/plugins/registry";
import {
	getCachedPluginToolDefinitions,
	setCachedPluginToolDefinitions,
} from "../integrations/plugins/tool-def-cache";
import type {
	IntegrationModule,
	ProviderCategory,
} from "../integrations/types";
import { daemonLog } from "../logging/daemon-log";

export type ResolvedToolTarget = {
	readonly moduleName: string;
	readonly toolName: string;
	readonly standardTool?: string;
};

export type ExecuteToolResult =
	| {
			readonly ok: true;
			readonly result: unknown;
			readonly appliedActions?: readonly string[];
			readonly moduleName: string;
			readonly toolName: string;
			readonly standardTool?: string;
	  }
	| {
			readonly ok: false;
			readonly error: string;
			readonly moduleName?: string;
			readonly toolName?: string;
			readonly standardTool?: string;
	  };

/** Reverse map: standardTool id → provider category (when known). */
function categoryForStandardTool(standardToolId: string): string | undefined {
	for (const [category, id] of Object.entries(STANDARD_TOOL_FOR_CATEGORY)) {
		if (id === standardToolId) return category;
	}
	return undefined;
}

function buildPluginEnvelope(moduleName: string): {
	config: Record<string, unknown>;
	state: Record<string, unknown>;
} {
	const creds: CredentialsFile = readCredentials();
	const configBlock = creds.integrations?.[moduleName];
	const config =
		configBlock && typeof configBlock === "object" ? { ...configBlock } : {};
	const appConfig = readConfig();
	const stateBlock = appConfig.integrations?.[moduleName];
	const state =
		stateBlock && typeof stateBlock === "object" ? { ...stateBlock } : {};
	return { config, state };
}

/** Cached `tools list` for a plugin module, or null if unavailable. */
export function listModuleToolDefinitions(
	moduleName: string,
): NonNullable<PluginToolsListResponse["tools"]> | null {
	const metadata = getPluginMetadata(moduleName);
	if (!metadata) return null;

	const cached = getCachedPluginToolDefinitions({
		target: metadata.target,
		version: metadata.version,
		protocolVersion: metadata.protocolVersion,
	});
	if (cached) return cached;

	const toolsResult = pluginToolsList(metadata.target);
	if (!toolsResult.ok || !toolsResult.data.ok || !toolsResult.data.tools) {
		return null;
	}
	setCachedPluginToolDefinitions({
		target: metadata.target,
		version: metadata.version,
		protocolVersion: metadata.protocolVersion,
		tools: toolsResult.data.tools,
	});
	return toolsResult.data.tools;
}

function findToolNameForStandardTool(
	moduleName: string,
	standardToolId: string,
): string | null {
	const defs = listModuleToolDefinitions(moduleName);
	if (!defs) return null;
	const match = defs.find((t) => t.standardTool === standardToolId);
	return match?.name ?? null;
}

/**
 * Resolve which connected module + tool name implements a standardTool id.
 * Prefers the configured default provider for the matching category when set.
 */
export async function resolveStandardTool(
	standardToolId: string,
): Promise<ResolvedToolTarget | null> {
	const category = categoryForStandardTool(standardToolId);
	let modules = getIntegrationModules().filter((m) => {
		if (
			category &&
			m.providerCategories?.includes(category as ProviderCategory)
		) {
			return true;
		}
		// Fall back: any module that might expose the tag (checked below).
		return !category;
	});

	// If category known but no modules filtered, scan all modules.
	if (modules.length === 0) {
		modules = getIntegrationModules();
	}

	if (category) {
		const defaultName = getDefaultProvider(category as ProviderCategory);
		if (defaultName) {
			const preferred = modules.filter((m) => m.name === defaultName);
			if (preferred.length > 0) {
				modules = preferred;
			}
		}
	}

	const connected: IntegrationModule[] = [];
	for (const m of modules) {
		const isConnected = await m.isConnected().catch(() => false);
		if (isConnected) connected.push(m);
	}

	const candidates = connected.length > 0 ? connected : modules;

	for (const m of candidates) {
		const toolName = findToolNameForStandardTool(m.name, standardToolId);
		if (toolName) {
			return {
				moduleName: m.name,
				toolName,
				standardTool: standardToolId,
			};
		}
	}

	// Last resort: scan every module's tool defs (e.g. standardTool without category).
	for (const m of getIntegrationModules()) {
		const toolName = findToolNameForStandardTool(m.name, standardToolId);
		if (!toolName) continue;
		const isConnected = await m.isConnected().catch(() => false);
		if (!isConnected) continue;
		return {
			moduleName: m.name,
			toolName,
			standardTool: standardToolId,
		};
	}

	return null;
}

/** Resolve a named module + tool (verifies the tool exists when defs are available). */
export async function resolveNamedTool(
	moduleName: string,
	toolName: string,
): Promise<ResolvedToolTarget | null> {
	const module = getIntegrationModules().find((m) => m.name === moduleName);
	if (!module) return null;
	const connected = await module.isConnected().catch(() => false);
	if (!connected) {
		// Still allow resolution so the executor can report a clear error.
	}
	const defs = listModuleToolDefinitions(moduleName);
	if (defs && !defs.some((t) => t.name === toolName)) {
		return null;
	}
	return { moduleName, toolName };
}

/**
 * Execute a plugin tool by module + tool name with the given input object.
 */
export async function executeNamedTool(params: {
	readonly moduleName: string;
	readonly toolName: string;
	readonly input: Record<string, unknown>;
	readonly standardTool?: string;
}): Promise<ExecuteToolResult> {
	const metadata = getPluginMetadata(params.moduleName);
	if (!metadata) {
		return {
			ok: false,
			error: `No plugin metadata for module "${params.moduleName}"`,
			moduleName: params.moduleName,
			toolName: params.toolName,
			standardTool: params.standardTool,
		};
	}

	const envelope = buildPluginEnvelope(params.moduleName);
	const dataDir = ensurePluginDataDir(params.moduleName);

	const execResult = await pluginToolsExecuteAsync(metadata.target, {
		tool: params.toolName,
		input: params.input,
		config: envelope.config,
		state: envelope.state,
		dryRun: false,
		paths: { dataDir },
	});

	forwardPluginStderr(params.moduleName, execResult.stderr);

	if (!execResult.ok) {
		daemonLog("warn", "plugin", "flow_tool_exec_failed", {
			plugin: params.moduleName,
			tool: params.toolName,
			error: execResult.error,
		});
		return {
			ok: false,
			error: execResult.error,
			moduleName: params.moduleName,
			toolName: params.toolName,
			standardTool: params.standardTool,
		};
	}

	if (!execResult.data.ok) {
		const error =
			execResult.data.error ?? execResult.data.code ?? "Tool execution failed";
		daemonLog("warn", "plugin", "flow_tool_exec_failed", {
			plugin: params.moduleName,
			tool: params.toolName,
			error,
		});
		return {
			ok: false,
			error: String(error),
			moduleName: params.moduleName,
			toolName: params.toolName,
			standardTool: params.standardTool,
		};
	}

	const appliedActions = execResult.data.appliedActions;
	return {
		ok: true,
		result: execResult.data.result,
		...(appliedActions && appliedActions.length > 0
			? { appliedActions: [...appliedActions] }
			: {}),
		moduleName: params.moduleName,
		toolName: params.toolName,
		standardTool: params.standardTool,
	};
}

/** Resolve and execute a standardTool or named tool. */
export async function executeToolRef(
	tool:
		| { readonly standardTool: string }
		| { readonly moduleName: string; readonly toolName: string },
	input: Record<string, unknown>,
): Promise<ExecuteToolResult> {
	if ("standardTool" in tool) {
		const resolved = await resolveStandardTool(tool.standardTool);
		if (!resolved) {
			return {
				ok: false,
				error: `No connected provider implements standardTool "${tool.standardTool}"`,
				standardTool: tool.standardTool,
			};
		}
		return executeNamedTool({
			moduleName: resolved.moduleName,
			toolName: resolved.toolName,
			input,
			standardTool: tool.standardTool,
		});
	}

	const resolved = await resolveNamedTool(tool.moduleName, tool.toolName);
	if (!resolved) {
		return {
			ok: false,
			error: `Tool "${tool.toolName}" not found on module "${tool.moduleName}"`,
			moduleName: tool.moduleName,
			toolName: tool.toolName,
		};
	}
	return executeNamedTool({
		moduleName: resolved.moduleName,
		toolName: resolved.toolName,
		input,
	});
}
