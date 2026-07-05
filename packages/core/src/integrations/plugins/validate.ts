import { STANDARD_TOOL_FOR_CATEGORY } from "../../dashboard/types";
import { type PluginMetadata, inspectPluginBinary } from "./adapter";
import { pluginConfigShape, pluginToolsList } from "./client";
import type {
	DiscoveredPlugin,
	PluginConfigField,
	PluginInvocationTarget,
	PluginToolDefinition,
} from "./protocol";
import { resolvePluginTarget } from "./runtime";

/** Config shape keys that incorrectly include the plugin name prefix. */
export function findPrefixedPluginConfigFieldKeys(
	pluginName: string,
	fields: readonly PluginConfigField[],
): string[] {
	const prefix = `${pluginName}.`;
	return fields
		.map((field) => field.key)
		.filter((key) => key.startsWith(prefix));
}

export function validatePluginConfigShapeFields(
	pluginName: string,
	fields: readonly PluginConfigField[] | undefined,
): string | undefined {
	if (!fields?.length) {
		return undefined;
	}
	const prefixed = findPrefixedPluginConfigFieldKeys(pluginName, fields);
	if (prefixed.length === 0) {
		return undefined;
	}
	return (
		`Config shape field keys must be local to the plugin (found prefixed keys: ${prefixed.join(", ")}). ` +
		`Toby namespaces configure keys as ${pluginName}.<key> and stores values under integrations.${pluginName}.<key>.`
	);
}

export type PluginValidationResult =
	| { readonly ok: true; readonly metadata: PluginMetadata }
	| {
			readonly ok: false;
			readonly error: string;
			readonly code: string;
			readonly binaryName: string;
	  };

export function validatePluginBinary(
	discovered: DiscoveredPlugin,
): PluginValidationResult {
	const inspected = inspectPluginBinary(discovered);
	if ("error" in inspected) {
		return {
			ok: false,
			error: inspected.error,
			code: inspected.code,
			binaryName: discovered.binaryName,
		};
	}

	let target: PluginInvocationTarget;
	try {
		target = resolvePluginTarget(discovered);
	} catch (err) {
		return {
			ok: false,
			error: (err as Error).message,
			code: "runtime_not_found",
			binaryName: discovered.binaryName,
		};
	}

	const tools = pluginToolsList(target);
	if (!tools.ok) {
		return {
			ok: false,
			error: tools.error,
			code: tools.code,
			binaryName: discovered.binaryName,
		};
	}

	if (!tools.data.ok) {
		return {
			ok: false,
			error: tools.data.error ?? "Plugin tools list returned ok:false",
			code: tools.data.code ?? "tools_list_failed",
			binaryName: discovered.binaryName,
		};
	}

	const shape = pluginConfigShape(target);
	if (!shape.ok) {
		return {
			ok: false,
			error: shape.error,
			code: shape.code,
			binaryName: discovered.binaryName,
		};
	}
	if (!shape.data.ok) {
		return {
			ok: false,
			error: shape.data.error ?? "Plugin config shape returned ok:false",
			code: shape.data.code ?? "config_shape_failed",
			binaryName: discovered.binaryName,
		};
	}

	const shapeError = validatePluginConfigShapeFields(
		inspected.name,
		shape.data.fields,
	);
	if (shapeError) {
		return {
			ok: false,
			error: shapeError,
			code: "prefixed_config_shape_keys",
			binaryName: discovered.binaryName,
		};
	}

	return { ok: true, metadata: inspected };
}

/**
 * Check whether a plugin declaring a provider category with a standard tool
 * contract actually exposes a tool tagged with the matching `standardTool` ID.
 * Returns a list of advisory warnings (empty if compliant or no categories).
 */
export function checkStandardToolCompliance(
	metadata: PluginMetadata,
	tools: readonly PluginToolDefinition[],
): string[] {
	const warnings: string[] = [];
	const categories = metadata.providerCategories;
	if (!categories || categories.length === 0) return warnings;

	for (const category of categories) {
		const expectedStandardTool = STANDARD_TOOL_FOR_CATEGORY[category];
		if (!expectedStandardTool) continue;
		const hasStandardTool = tools.some(
			(t) => t.standardTool === expectedStandardTool,
		);
		if (!hasStandardTool) {
			warnings.push(
				`Plugin "${metadata.name}" declares providerCategory "${category}" but no tool is tagged with standardTool "${expectedStandardTool}". Dashboard summaries for this category will not include this plugin.`,
			);
		}
	}

	return warnings;
}
