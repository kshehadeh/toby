import { pluginToolsList } from "./plugins/client";
import { getPluginMetadata } from "./plugins/registry";
import {
	getCachedPluginToolDefinitions,
	setCachedPluginToolDefinitions,
} from "./plugins/tool-def-cache";

export type ListedIntegrationTool = {
	readonly name: string;
	readonly displayName: string;
	readonly description: string;
	readonly readOnly: boolean;
	readonly standardTool?: string;
	readonly inputSchema: {
		readonly type?: string;
		readonly properties?: Readonly<Record<string, unknown>>;
		readonly required?: readonly string[];
	};
};

function schemaRecord(
	schema: Record<string, unknown> | undefined,
): ListedIntegrationTool["inputSchema"] {
	if (!schema || typeof schema !== "object") {
		return { type: "object", properties: {} };
	}
	const properties =
		schema.properties && typeof schema.properties === "object"
			? (schema.properties as Record<string, unknown>)
			: {};
	const required = Array.isArray(schema.required)
		? schema.required.filter((item): item is string => typeof item === "string")
		: undefined;
	return {
		type: typeof schema.type === "string" ? schema.type : "object",
		properties,
		...(required ? { required } : {}),
	};
}

/**
 * Tools for an integration already in the registry.
 * Uses the same cached `tools list` as Integrations status — does not
 * discover plugins or inspect install directories.
 */
export function listIntegrationTools(name: string): ListedIntegrationTool[] {
	const metadata = getPluginMetadata(name);
	if (!metadata) return [];

	let tools = getCachedPluginToolDefinitions({
		target: metadata.target,
		version: metadata.version,
		protocolVersion: metadata.protocolVersion,
	});
	if (!tools) {
		const result = pluginToolsList(metadata.target);
		if (!result.ok || !result.data.ok || !result.data.tools) {
			return [];
		}
		tools = result.data.tools;
		setCachedPluginToolDefinitions({
			target: metadata.target,
			version: metadata.version,
			protocolVersion: metadata.protocolVersion,
			tools,
		});
	}

	return tools.map((tool) => ({
		name: tool.name,
		displayName: tool.displayName ?? tool.name,
		description: tool.description,
		readOnly: tool.readOnly ?? false,
		...(tool.standardTool ? { standardTool: tool.standardTool } : {}),
		inputSchema: schemaRecord(tool.inputSchema),
	}));
}
