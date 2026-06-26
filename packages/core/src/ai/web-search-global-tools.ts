import { type Tool, tool } from "ai";
import { z } from "zod";
import {
	getIntegrationCredential,
	readConfig,
	readCredentials,
} from "../config/index";
import { mergePluginConfigPatch } from "../integrations/plugins/adapter";
import { pluginToolsExecute } from "../integrations/plugins/client";
import { findDiscoveredPlugin } from "../integrations/plugins/registry";
import { resolvePluginTarget } from "../integrations/plugins/runtime";

const PLUGIN_NAME = "websearch";

export function getWebSearchApiKeyRaw(): string | undefined {
	const creds = readCredentials();
	const apiKey =
		getIntegrationCredential(creds, PLUGIN_NAME, "apiKey") ??
		creds.integrations?.websearch?.apiKey ??
		creds.integrations?.bravesearch?.apiKey;
	return apiKey?.trim() || undefined;
}

export function isWebSearchAvailable(): boolean {
	if (!getWebSearchApiKeyRaw()) {
		return false;
	}
	return Boolean(findDiscoveredPlugin(PLUGIN_NAME));
}

function buildPluginEnvelope(): {
	readonly config: Record<string, unknown>;
	readonly state: Record<string, unknown>;
} {
	const creds = readCredentials();
	const config = readConfig();
	const configBlock = creds.integrations?.[PLUGIN_NAME];
	const stateBlock = config.integrations?.[PLUGIN_NAME];
	return {
		config:
			configBlock && typeof configBlock === "object" ? { ...configBlock } : {},
		state:
			stateBlock && typeof stateBlock === "object" ? { ...stateBlock } : {},
	};
}

interface WebSearchToolContext {
	readonly dryRun: boolean;
	readonly appliedActions: string[];
}

export function createWebSearchGlobalTools(
	ctx: WebSearchToolContext,
): Record<string, Tool> {
	const discovered = findDiscoveredPlugin(PLUGIN_NAME);
	if (!discovered || !getWebSearchApiKeyRaw()) {
		return {};
	}

	return {
		webSearch: tool({
			description:
				"Search the web using Brave Search. Returns a list of results with title, URL, description, and optional page age. Use this to find information on the web, research topics, or look up facts.",
			inputSchema: z.object({
				query: z.string().min(1).describe("The search query"),
				count: z
					.number()
					.int()
					.min(1)
					.max(20)
					.optional()
					.describe("Number of results to return (1-20, default 10)"),
				freshness: z
					.enum(["pd", "pw", "pm", "py"])
					.optional()
					.describe(
						"Time filter: pd=past day, pw=past week, pm=past month, py=past year",
					),
			}),
			execute: async ({ query, count, freshness }) => {
				const envelope = buildPluginEnvelope();
				const execResult = pluginToolsExecute(resolvePluginTarget(discovered), {
					tool: "webSearch",
					input: {
						query,
						...(count !== undefined ? { count } : {}),
						...(freshness ? { freshness } : {}),
					},
					config: envelope.config,
					state: envelope.state,
					dryRun: ctx.dryRun,
				});

				if (!execResult.ok) {
					return { error: execResult.error };
				}
				if (!execResult.data.ok) {
					return { error: execResult.data.error ?? "Tool execution failed" };
				}

				mergePluginConfigPatch(PLUGIN_NAME, execResult.data.config);

				if (execResult.data.appliedActions?.length) {
					ctx.appliedActions.push(...execResult.data.appliedActions);
				}

				return execResult.data.result ?? { ok: true };
			},
		}),
	};
}
