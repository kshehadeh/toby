import { resolveActivePluginDirectory } from "../../integrations/plugins/discovery";
import { collectPluginListEntries } from "../../integrations/plugins/list-status";
import { jsonResponse } from "../http-utils";

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
			state: entry.state,
			connected: entry.connected,
			error: entry.error ?? null,
			errorCode: entry.errorCode ?? null,
		})),
	});
}
