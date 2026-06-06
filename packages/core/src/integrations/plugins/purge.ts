import fs from "node:fs";
import { clearToolResultCacheForTools } from "../../chat-pipeline/tool-result-cache";
import {
	ensureTobyDir,
	getConfigPath,
	readCredentials,
	writeCredentials,
} from "../../config/index";
import { pluginDisconnect, pluginToolsList } from "./client";
import type { PluginConfigEnvelope } from "./protocol";

export type PluginPurgeResult = {
	readonly credentials: boolean;
	readonly connectionState: boolean;
	readonly disabledEntry: boolean;
	readonly defaultProviderReferences: number;
	readonly chatInboundReference: boolean;
	readonly toolCacheEntries: number;
};

export function purgePluginArtifacts(
	name: string,
	options: { toolNames?: readonly string[] } = {},
): PluginPurgeResult {
	const normalized = name.trim();
	const credentials = purgePluginCredentials(normalized);
	const configPurge = purgePluginConfigReferences(normalized);
	const toolCacheEntries = clearToolResultCacheForTools(
		options.toolNames ?? [],
	);

	return {
		credentials,
		...configPurge,
		toolCacheEntries,
	};
}

function purgePluginCredentials(name: string): boolean {
	const creds = readCredentials();
	if (!creds.integrations?.[name]) {
		return false;
	}

	const nextIntegrations = { ...(creds.integrations ?? {}) };
	Reflect.deleteProperty(nextIntegrations, name);
	writeCredentials({
		...creds,
		integrations: nextIntegrations,
	});
	return true;
}

function purgePluginConfigReferences(
	name: string,
): Omit<PluginPurgeResult, "credentials" | "toolCacheEntries"> {
	ensureTobyDir();
	const configPath = getConfigPath();
	let configRaw: Record<string, unknown> = { integrations: {}, personas: [] };
	if (fs.existsSync(configPath)) {
		configRaw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as Record<
			string,
			unknown
		>;
	}

	const integrations = {
		...((configRaw.integrations ?? {}) as Record<string, unknown>),
	};
	const connectionState = name in integrations;
	if (connectionState) {
		Reflect.deleteProperty(integrations, name);
		configRaw.integrations = integrations;
	}

	const pluginsBlock = configRaw.plugins as { disabled?: string[] } | undefined;
	let disabledEntry = false;
	if (pluginsBlock?.disabled?.includes(name)) {
		configRaw.plugins = {
			...pluginsBlock,
			disabled: pluginsBlock.disabled.filter((entry) => entry !== name),
		};
		disabledEntry = true;
	}

	const defaultProviders = {
		...((configRaw.defaultProviders ?? {}) as Record<string, string>),
	};
	let defaultProviderReferences = 0;
	for (const [category, provider] of Object.entries(defaultProviders)) {
		if (provider !== name) continue;
		Reflect.deleteProperty(defaultProviders, category);
		defaultProviderReferences += 1;
	}
	if (defaultProviderReferences > 0) {
		configRaw.defaultProviders = defaultProviders;
	}

	const chatInbound = {
		...((configRaw.chatInbound ?? {}) as Record<string, unknown>),
	};
	let chatInboundReference = false;
	if (chatInbound.integration === name) {
		Reflect.deleteProperty(chatInbound, "integration");
		configRaw.chatInbound = chatInbound;
		chatInboundReference = true;
	}

	fs.writeFileSync(configPath, JSON.stringify(configRaw, null, 2));

	return {
		connectionState,
		disabledEntry,
		defaultProviderReferences,
		chatInboundReference,
	};
}

export function notifyPluginDisconnect(binaryPath: string, name: string): void {
	const creds = readCredentials();
	const configPath = getConfigPath();
	let state: Record<string, unknown> = {};
	if (fs.existsSync(configPath)) {
		const configRaw = JSON.parse(
			fs.readFileSync(configPath, "utf-8"),
		) as Record<string, unknown>;
		state = {
			...(((configRaw.integrations ?? {}) as Record<string, unknown>)[name] ??
				{}),
		};
	}

	if (!state.connectedAt && !creds.integrations?.[name]) {
		return;
	}

	const envelope: PluginConfigEnvelope = {
		config: { ...(creds.integrations?.[name] ?? {}) },
		state,
	};
	const result = pluginDisconnect(binaryPath, envelope);
	if (!result.ok || !result.data.ok) {
		return;
	}
}

export function listPluginToolNames(binaryPath: string): string[] {
	const tools = pluginToolsList(binaryPath);
	if (!tools.ok || !tools.data.ok || !tools.data.tools) {
		return [];
	}
	return tools.data.tools.map((tool) => tool.name);
}
