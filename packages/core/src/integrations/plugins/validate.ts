import { type PluginMetadata, inspectPluginBinary } from "./adapter";
import { pluginConfigShape, pluginToolsList } from "./client";
import type { DiscoveredPlugin, PluginConfigField } from "./protocol";

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
			readonly binaryPath: string;
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
			binaryPath: discovered.binaryPath,
		};
	}

	const tools = pluginToolsList(discovered.binaryPath);
	if (!tools.ok) {
		return {
			ok: false,
			error: tools.error,
			code: tools.code,
			binaryPath: discovered.binaryPath,
		};
	}

	if (!tools.data.ok) {
		return {
			ok: false,
			error: tools.data.error ?? "Plugin tools list returned ok:false",
			code: tools.data.code ?? "tools_list_failed",
			binaryPath: discovered.binaryPath,
		};
	}

	if (
		inspected.capabilities.includes("transcription") &&
		!tools.data.tools?.some((tool) => tool.name === "doTranscription")
	) {
		return {
			ok: false,
			error: `Plugin "${inspected.name}" declares transcription capability but tools list is missing doTranscription`,
			code: "missing_do_transcription",
			binaryPath: discovered.binaryPath,
		};
	}

	const shape = pluginConfigShape(discovered.binaryPath);
	if (!shape.ok) {
		return {
			ok: false,
			error: shape.error,
			code: shape.code,
			binaryPath: discovered.binaryPath,
		};
	}
	if (!shape.data.ok) {
		return {
			ok: false,
			error: shape.data.error ?? "Plugin config shape returned ok:false",
			code: shape.data.code ?? "config_shape_failed",
			binaryPath: discovered.binaryPath,
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
			binaryPath: discovered.binaryPath,
		};
	}

	return { ok: true, metadata: inspected };
}
