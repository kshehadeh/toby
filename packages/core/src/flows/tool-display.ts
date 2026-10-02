import { getDefaultProvider } from "../config/index";
import { STANDARD_TOOL_FOR_CATEGORY } from "../dashboard/types";
import { getIntegrationModules } from "../integrations/index";
import { listIntegrationTools } from "../integrations/list-tools";
import type {
	IntegrationModule,
	ProviderCategory,
} from "../integrations/types";
import type { ToolRef } from "./types";

/**
 * Human-facing description of a flow step's tool, for read-only UI such as
 * the Flows detail pane. Everything here is best effort: a field is omitted
 * when it cannot be resolved without running the tool.
 */
export type FlowToolDisplay = {
	/** The tool's own display name, e.g. "Open tasks summary". */
	readonly title?: string;
	/** The tool's description from its integration. */
	readonly description?: string;
	readonly integrationName?: string;
	readonly integrationDisplayName?: string;
	/** Relative icon URL served by the local API. */
	readonly integrationIconUrl?: string;
	/** Provider category for standard tools ("email", "tasks", "calendar"). */
	readonly category?: string;
};

function categoryForStandardTool(standardToolId: string): string | undefined {
	for (const [category, id] of Object.entries(STANDARD_TOOL_FOR_CATEGORY)) {
		if (id === standardToolId) return category;
	}
	return undefined;
}

function describeModuleTool(
	module: IntegrationModule,
	match: (tool: { name: string; standardTool?: string }) => boolean,
): FlowToolDisplay {
	const tool = listIntegrationTools(module.name).find(match);
	return {
		...(tool?.displayName ? { title: tool.displayName } : {}),
		...(tool?.description ? { description: tool.description } : {}),
		integrationName: module.name,
		integrationDisplayName: module.displayName,
		...(module.iconUrl ? { integrationIconUrl: module.iconUrl } : {}),
	};
}

/**
 * Pick the integration that would serve a standard tool without checking
 * connections: the configured default provider for its category, else the
 * only module in that category that implements it. Ambiguous cases return
 * just the category so the UI can say "your calendar" instead of guessing.
 */
function describeStandardTool(standardToolId: string): FlowToolDisplay {
	const category = categoryForStandardTool(standardToolId);
	const implementsTool = (module: IntegrationModule) =>
		listIntegrationTools(module.name).some(
			(tool) => tool.standardTool === standardToolId,
		);
	const modules = getIntegrationModules();

	if (category) {
		const defaultName = getDefaultProvider(category as ProviderCategory);
		const preferred = defaultName
			? modules.find((m) => m.name === defaultName)
			: undefined;
		if (preferred && implementsTool(preferred)) {
			return {
				...describeModuleTool(
					preferred,
					(tool) => tool.standardTool === standardToolId,
				),
				category,
			};
		}
	}

	const candidates = modules.filter(
		(m) =>
			(!category ||
				m.providerCategories?.includes(category as ProviderCategory)) &&
			implementsTool(m),
	);
	if (candidates.length === 1 && candidates[0]) {
		return {
			...describeModuleTool(
				candidates[0],
				(tool) => tool.standardTool === standardToolId,
			),
			...(category ? { category } : {}),
		};
	}
	return category ? { category } : {};
}

export function describeFlowTool(tool: ToolRef): FlowToolDisplay {
	if ("userToolId" in tool) {
		return tool.displayName ? { title: tool.displayName } : {};
	}
	if ("standardTool" in tool) {
		return describeStandardTool(tool.standardTool);
	}
	const module = getIntegrationModules().find(
		(m) => m.name === tool.moduleName,
	);
	if (!module) return {};
	return describeModuleTool(
		module,
		(candidate) => candidate.name === tool.toolName,
	);
}
