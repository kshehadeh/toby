import fs from "node:fs";
import path from "node:path";
import { isAllowedPluginIconMimeType } from "./icons";
import type { PluginManifest, PluginManifestEvents } from "./protocol";
import {
	isSupportedProtocolVersion,
	parsePluginNameFromBinary,
} from "./protocol";

export type ManifestParseResult =
	| { readonly ok: true; readonly manifest: PluginManifest }
	| { readonly ok: false; readonly error: string; readonly code: string };

/**
 * Read and parse `manifest.json` from a plugin directory.
 * Does NOT validate field consistency — use {@link validateManifest} for that.
 */
export function parseManifest(directoryPath: string): ManifestParseResult {
	const manifestPath = path.join(directoryPath, "manifest.json");

	let raw: string;
	try {
		raw = fs.readFileSync(manifestPath, "utf8");
	} catch {
		return {
			ok: false,
			error: `manifest.json not found in ${directoryPath}`,
			code: "manifest_not_found",
		};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {
			ok: false,
			error: `manifest.json contains invalid JSON in ${directoryPath}`,
			code: "manifest_invalid_json",
		};
	}

	return validateManifestStructure(parsed, directoryPath);
}

function validateManifestStructure(
	parsed: unknown,
	dirPath: string,
): ManifestParseResult {
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return {
			ok: false,
			error: "manifest.json must be a JSON object",
			code: "manifest_invalid_structure",
		};
	}

	const obj = parsed as Record<string, unknown>;

	const name = obj.name;
	if (typeof name !== "string" || !name) {
		return {
			ok: false,
			error: "manifest.json missing required string field: name",
			code: "manifest_missing_name",
		};
	}

	const displayName = obj.displayName;
	if (typeof displayName !== "string" || !displayName) {
		return {
			ok: false,
			error: "manifest.json missing required string field: displayName",
			code: "manifest_missing_display_name",
		};
	}

	const description = obj.description;
	if (typeof description !== "string") {
		return {
			ok: false,
			error: "manifest.json missing required string field: description",
			code: "manifest_missing_description",
		};
	}

	const version = obj.version;
	if (typeof version !== "string" || !version) {
		return {
			ok: false,
			error: "manifest.json missing required string field: version",
			code: "manifest_missing_version",
		};
	}

	const protocolVersion = obj.protocolVersion;
	if (typeof protocolVersion !== "string" || !protocolVersion) {
		return {
			ok: false,
			error: "manifest.json missing required string field: protocolVersion",
			code: "manifest_missing_protocol_version",
		};
	}

	const runtime = obj.runtime;
	if (
		typeof runtime !== "object" ||
		runtime === null ||
		Array.isArray(runtime)
	) {
		return {
			ok: false,
			error: "manifest.json missing required object field: runtime",
			code: "manifest_missing_runtime",
		};
	}

	const runtimeObj = runtime as Record<string, unknown>;
	if (runtimeObj.type !== "bun") {
		return {
			ok: false,
			error: `manifest.json runtime.type must be "bun" (got "${String(runtimeObj.type)}")`,
			code: "manifest_unsupported_runtime",
		};
	}

	if (typeof runtimeObj.entry !== "string" || !runtimeObj.entry) {
		return {
			ok: false,
			error: "manifest.json runtime.entry must be a non-empty string",
			code: "manifest_missing_entry",
		};
	}

	const capabilities = obj.capabilities;
	if (capabilities !== undefined && !Array.isArray(capabilities)) {
		return {
			ok: false,
			error: "manifest.json capabilities must be an array if present",
			code: "manifest_invalid_capabilities",
		};
	}

	const providerCategories = obj.providerCategories;
	if (providerCategories !== undefined && !Array.isArray(providerCategories)) {
		return {
			ok: false,
			error: "manifest.json providerCategories must be an array if present",
			code: "manifest_invalid_provider_categories",
		};
	}

	let events: PluginManifestEvents | undefined;
	const eventsRaw = obj.events;
	if (eventsRaw !== undefined) {
		if (
			typeof eventsRaw !== "object" ||
			eventsRaw === null ||
			Array.isArray(eventsRaw)
		) {
			return {
				ok: false,
				error: "manifest.json events must be an object if present",
				code: "manifest_invalid_events",
			};
		}
		const eventsObj = eventsRaw as Record<string, unknown>;
		let poll: PluginManifestEvents["poll"];
		if (eventsObj.poll !== undefined) {
			if (
				typeof eventsObj.poll !== "object" ||
				eventsObj.poll === null ||
				Array.isArray(eventsObj.poll)
			) {
				return {
					ok: false,
					error: "manifest.json events.poll must be an object if present",
					code: "manifest_invalid_events_poll",
				};
			}
			const pollObj = eventsObj.poll as Record<string, unknown>;
			const intervalSeconds = pollObj.intervalSeconds;
			if (
				typeof intervalSeconds !== "number" ||
				!Number.isFinite(intervalSeconds) ||
				intervalSeconds < 1
			) {
				return {
					ok: false,
					error:
						"manifest.json events.poll.intervalSeconds must be a positive number (>= 1)",
					code: "manifest_invalid_poll_interval",
				};
			}
			poll = { intervalSeconds: Math.floor(intervalSeconds) };
		}
		events = poll ? { poll } : undefined;
	}

	let iconAsset: PluginManifest["iconAsset"];
	const iconAssetRaw = obj.iconAsset;
	if (iconAssetRaw !== undefined) {
		if (
			typeof iconAssetRaw !== "object" ||
			iconAssetRaw === null ||
			Array.isArray(iconAssetRaw)
		) {
			return {
				ok: false,
				error: "manifest.json iconAsset must be an object if present",
				code: "manifest_invalid_icon_asset",
			};
		}
		const iconAssetObj = iconAssetRaw as Record<string, unknown>;
		if (typeof iconAssetObj.path !== "string" || !iconAssetObj.path) {
			return {
				ok: false,
				error: "manifest.json iconAsset.path must be a non-empty string",
				code: "manifest_invalid_icon_asset_path",
			};
		}
		const mimeType = iconAssetObj.mimeType;
		if (
			mimeType !== undefined &&
			(typeof mimeType !== "string" || !isAllowedPluginIconMimeType(mimeType))
		) {
			return {
				ok: false,
				error:
					"manifest.json iconAsset.mimeType must be one of image/png, image/jpeg, image/webp",
				code: "manifest_invalid_icon_asset_mime_type",
			};
		}
		iconAsset = {
			path: iconAssetObj.path,
			...(typeof mimeType === "string" ? { mimeType } : {}),
		};
	}

	return {
		ok: true,
		manifest: {
			name,
			displayName,
			description,
			version,
			protocolVersion,
			runtime: {
				type: "bun",
				entry: runtimeObj.entry,
			},
			capabilities: capabilities as PluginManifest["capabilities"],
			providerCategories:
				providerCategories as PluginManifest["providerCategories"],
			events,
			icon: typeof obj.icon === "string" ? obj.icon : undefined,
			iconAsset,
			inboundTransport:
				typeof obj.inboundTransport === "string"
					? obj.inboundTransport
					: undefined,
		},
	};
}

export type ManifestValidationResult =
	| { readonly ok: true }
	| { readonly ok: false; readonly error: string; readonly code: string };

/**
 * Validate a parsed manifest against the plugin directory and expected name.
 * Checks: name matches directory, protocol version supported, entry file exists.
 */
export function validateManifest(
	manifest: PluginManifest,
	directoryPath: string,
	directoryName: string,
): ManifestValidationResult {
	const parsedName = parsePluginNameFromBinary(directoryName);
	if (!parsedName) {
		return {
			ok: false,
			error: `Invalid plugin directory name: ${directoryName}`,
			code: "invalid_name",
		};
	}

	if (manifest.name !== parsedName) {
		return {
			ok: false,
			error: `Manifest name "${manifest.name}" does not match directory name suffix "${parsedName}"`,
			code: "name_mismatch",
		};
	}

	if (!isSupportedProtocolVersion(manifest.protocolVersion)) {
		return {
			ok: false,
			error: `Unsupported protocol version: ${manifest.protocolVersion}`,
			code: "unsupported_protocol",
		};
	}

	const entryPath = path.resolve(directoryPath, manifest.runtime.entry);
	if (!fs.existsSync(entryPath)) {
		return {
			ok: false,
			error: `Runtime entry file not found: ${manifest.runtime.entry} (resolved to ${entryPath})`,
			code: "entry_not_found",
		};
	}

	return { ok: true };
}
