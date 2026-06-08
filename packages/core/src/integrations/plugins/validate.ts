import { type PluginMetadata, inspectPluginBinary } from "./adapter";
import { pluginToolsList } from "./client";
import type { DiscoveredPlugin } from "./protocol";

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

	return { ok: true, metadata: inspected };
}
