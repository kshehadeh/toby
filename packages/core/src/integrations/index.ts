import type { ConnectionTypeDescriptor } from "./connection-types";
import { listMcpConnections, mcpTypeDescriptor } from "./connections";
import { createMcpIntegrationModule } from "./mcp/module";
import { getPluginModules } from "./plugins/registry";
import type {
	Integration,
	IntegrationCapability,
	IntegrationModule,
	ProviderCategory,
} from "./types";

const BUILTIN_MODULES: IntegrationModule[] = [];

function allModules(): IntegrationModule[] {
	const pluginModules = getPluginModules();
	const mcpModules = listMcpConnections().map(createMcpIntegrationModule);
	const byName = new Map<string, IntegrationModule>();
	for (const mod of BUILTIN_MODULES) {
		byName.set(mod.name, mod);
	}
	for (const mod of pluginModules) {
		if (!byName.has(mod.name)) {
			byName.set(mod.name, mod);
		}
	}
	for (const mod of mcpModules) {
		byName.set(mod.name, mod);
	}
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function listConnectionTypes(): ConnectionTypeDescriptor[] {
	const types: ConnectionTypeDescriptor[] = [mcpTypeDescriptor()];
	for (const mod of getPluginModules()) {
		types.push({
			typeId: mod.name,
			displayName: mod.displayName,
			description: mod.description,
			maxInstances: 1,
			capabilities: mod.capabilities,
		});
	}
	return types.sort((a, b) => a.typeId.localeCompare(b.typeId));
}

export function getIntegrationModules(): IntegrationModule[] {
	return allModules();
}

export function getIntegrationModule(
	name: string,
): IntegrationModule | undefined {
	return allModules().find((m) => m.name === name);
}

export function getModulesWithCapability(
	capability: IntegrationCapability,
): IntegrationModule[] {
	return allModules().filter((m) => m.capabilities.includes(capability));
}

export function getModulesForCategory(
	category: ProviderCategory,
): IntegrationModule[] {
	return allModules().filter((m) => m.providerCategories?.includes(category));
}

export function getIntegrations(): Integration[] {
	return allModules();
}

export function getIntegration(name: string): Integration | undefined {
	return getIntegrationModule(name);
}

/**
 * Resolves the relative icon URL for an integration by name (e.g.
 * `/api/plugins/slack/icon` for plugins, or `/icons/...` for built-ins).
 * Returns `undefined` when the integration is unknown or has no icon asset.
 */
export function getIntegrationIconUrl(name: string): string | undefined {
	return getIntegrationModule(name)?.iconUrl;
}

export function isBuiltinIntegration(name: string): boolean {
	return BUILTIN_MODULES.some((module) => module.name === name);
}

export {
	getPluginModules,
	resetPluginModuleCache,
	warmupPluginToolDefinitions,
} from "./plugins/registry";
export {
	allocateMcpConnectionId,
	deleteConnection,
	getConnection,
	listConnections,
	listMcpConnections,
	mcpPrefixedToolName,
	upsertConnection,
	MCP_CONNECTION_TYPE,
} from "./connections";
export {
	closeAllMcpSessions,
	connectMcpSession,
	disconnectMcpSession,
	reconnectConnectedMcpServers,
	setMcpClientFactory,
} from "./mcp/index";
