import { readConfig } from "../../config/index";
import type { IntegrationCapability } from "../types";
import { inspectPluginBinary } from "./adapter";
import { discoverPluginBinaries } from "./discovery";
import type { DiscoveredPlugin } from "./protocol";

export type PluginListEntryState = "valid" | "invalid" | "disabled";

export type PluginListEntry = {
	readonly discovered: DiscoveredPlugin;
	readonly name: string;
	readonly displayName?: string;
	readonly description?: string;
	readonly version?: string;
	readonly protocolVersion?: string;
	readonly capabilities?: readonly IntegrationCapability[];
	readonly state: PluginListEntryState;
	readonly connected: boolean;
	readonly error?: string;
	readonly errorCode?: string;
};

export function readDisabledPluginNames(): Set<string> {
	try {
		const config = readConfig() as { plugins?: { disabled?: string[] } };
		return new Set(
			(config.plugins?.disabled ?? []).filter((n) => typeof n === "string"),
		);
	} catch {
		return new Set();
	}
}

function pluginNameFromBinary(binaryName: string): string {
	return binaryName.replace(/^toby-plugin-/, "");
}

export function collectPluginListEntries(): PluginListEntry[] {
	const discovered = discoverPluginBinaries();
	const disabled = readDisabledPluginNames();
	const config = readConfig();

	return discovered.map((entry) => {
		const name = pluginNameFromBinary(entry.binaryName);

		if (disabled.has(name)) {
			return {
				discovered: entry,
				name,
				state: "disabled",
				connected: false,
			};
		}

		const inspected = inspectPluginBinary(entry);
		if ("error" in inspected) {
			return {
				discovered: entry,
				name,
				state: "invalid",
				connected: false,
				error: inspected.error,
				errorCode: inspected.code,
			};
		}

		return {
			discovered: entry,
			name: inspected.name,
			displayName: inspected.displayName,
			description: inspected.description,
			version: inspected.version,
			protocolVersion: inspected.protocolVersion,
			capabilities: inspected.capabilities,
			state: "valid",
			connected: Boolean(config.integrations?.[inspected.name]?.connectedAt),
		};
	});
}
