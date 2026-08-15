import { listIntegrationTools } from "../../integrations/list-tools";
import { resolveActivePluginDirectory } from "../../integrations/plugins/discovery";
import { readPluginIconAsset } from "../../integrations/plugins/icons";
import { collectPluginListEntries } from "../../integrations/plugins/list-status";
import {
	findDiscoveredPlugin,
	loadPluginMetadata,
	rememberPluginMetadata,
} from "../../integrations/plugins/registry";
import { errorResponse, jsonResponse } from "../http-utils";

export async function handlePluginsList(): Promise<Response> {
	const entries = collectPluginListEntries();
	return jsonResponse({
		directory: resolveActivePluginDirectory(),
		plugins: entries.map((entry) => ({
			name: entry.name,
			displayName: entry.displayName ?? entry.name,
			description: entry.description ?? null,
			version: entry.version ?? null,
			protocolVersion: entry.protocolVersion ?? null,
			icon: entry.icon ?? null,
			iconUrl: entry.iconUrl ?? null,
			state: entry.state,
			connected: entry.connected,
			error: entry.error ?? null,
			errorCode: entry.errorCode ?? null,
			tools: entry.state === "valid" ? listIntegrationTools(entry.name) : [],
		})),
	});
}

export async function handlePluginIcon(name: string): Promise<Response> {
	const decoded = decodeURIComponent(name);
	const discovered = findDiscoveredPlugin(decoded);
	if (!discovered) {
		return errorResponse("Plugin not found", 404);
	}
	const metadata = loadPluginMetadata(discovered);
	if ("error" in metadata) {
		return errorResponse(metadata.error, 404);
	}
	rememberPluginMetadata(metadata);

	const icon = readPluginIconAsset(metadata.target, metadata.iconAsset);
	if (!icon.ok) {
		return errorResponse(icon.error, icon.status);
	}

	const etag = `W/"${icon.stat.size}-${Math.floor(icon.stat.mtimeMs)}"`;
	const body = new ArrayBuffer(icon.bytes.byteLength);
	new Uint8Array(body).set(icon.bytes);
	return new Response(body, {
		headers: {
			"Content-Type": icon.contentType,
			"Content-Length": String(icon.bytes.byteLength),
			"Cache-Control": "public, max-age=86400",
			ETag: etag,
			"Last-Modified": icon.stat.mtime.toUTCString(),
		},
	});
}
