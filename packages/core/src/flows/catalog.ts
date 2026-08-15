import { getIntegrationModules } from "../integrations/index";
import { listIntegrationTools } from "../integrations/list-tools";
import type { FlowCatalogTool } from "./validate-user-flow";

export type FlowCatalogModule = {
	readonly name: string;
	readonly displayName: string;
	readonly connected: boolean;
	readonly tools: readonly FlowCatalogTool[];
};

export type FlowToolCatalog = {
	readonly modules: readonly FlowCatalogModule[];
};

/**
 * Tool picker data from the integration registry — the same modules and
 * tool list Integrations already uses. Does not discover plugin directories.
 */
export async function listFlowToolCatalog(): Promise<FlowToolCatalog> {
	const modules = getIntegrationModules();
	const out: FlowCatalogModule[] = [];

	for (const mod of modules) {
		const tools = listIntegrationTools(mod.name);
		if (tools.length === 0) continue;
		const connected = await mod.isConnected().catch(() => false);
		out.push({
			name: mod.name,
			displayName: mod.displayName,
			connected,
			tools: tools.map((tool) => ({
				moduleName: mod.name,
				toolName: tool.name,
				displayName: tool.displayName,
				description: tool.description,
				readOnly: tool.readOnly,
				...(tool.standardTool ? { standardTool: tool.standardTool } : {}),
				inputSchema: tool.inputSchema,
			})),
		});
	}

	return { modules: out };
}

export function catalogToolsList(
	catalog: FlowToolCatalog,
): readonly FlowCatalogTool[] {
	return catalog.modules.flatMap((mod) => mod.tools);
}

export function catalogConnectedNames(
	catalog: FlowToolCatalog,
): readonly string[] {
	return catalog.modules.filter((mod) => mod.connected).map((mod) => mod.name);
}
