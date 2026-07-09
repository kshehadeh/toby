import { tool } from "ai";
import type { Tool } from "ai";
import chalk from "chalk";
import { globalChatToolsPromptSection } from "../../ai/global-chat-tools";
import {
	clearSessionToolBundleCache,
	runSharedChatTurn,
} from "../../chat-pipeline/run-turn";
import type { CredentialsFile, Persona } from "../../config/index";
import {
	ensurePluginDataDir,
	readConfig,
	readCredentials,
	writeConfig,
	writeCredentials,
} from "../../config/index";
import { validateDashboardSummary } from "../../dashboard/schema";
import { STANDARD_TOOL_FOR_CATEGORY } from "../../dashboard/types";
import type { DashboardSummaryResult } from "../../dashboard/types";
import { daemonLog } from "../../logging/daemon-log";
import { composeSystemPromptWithPersona } from "../../personas/prompt";
import { registerPluginToolLabels } from "../../tool-labels";
import type {
	ChatRunOptions,
	CredentialFieldDescriptor,
	IntegrationModule,
	IntegrationToolHealth,
	TestConnectionOptions,
} from "../types";
import {
	pluginConfigSet,
	pluginConfigShape,
	pluginConnect,
	pluginDisconnect,
	pluginStatus,
	pluginStatusAsync,
	pluginToolsExecuteAsync,
	pluginToolsList,
} from "./client";
import { pluginIconUrl } from "./icons";
import { createPluginChatInboundProvider } from "./inbound-adapter";
import { jsonSchemaToZod } from "./json-schema";
import type {
	DiscoveredPlugin,
	PluginChatModelPrep,
	PluginConfigEnvelope,
	PluginIconAsset,
	PluginInboundPrep,
	PluginInvocationTarget,
	PluginToolsListResponse,
} from "./protocol";
import {
	isSupportedProtocolVersion,
	parsePluginNameFromBinary,
} from "./protocol";
import { resolvePluginTarget } from "./runtime";
import {
	getCachedPluginToolDefinitions,
	setCachedPluginToolDefinitions,
} from "./tool-def-cache";

export type PluginMetadata = {
	readonly target: PluginInvocationTarget;
	readonly name: string;
	readonly displayName: string;
	readonly description: string;
	readonly version: string;
	readonly protocolVersion: string;
	readonly capabilities: IntegrationModule["capabilities"];
	readonly providerCategories: IntegrationModule["providerCategories"];
	readonly resources: IntegrationModule["resources"];
	readonly authMethods: IntegrationModule["authMethods"];
	readonly chatModelPrep?: PluginChatModelPrep;
	readonly readOnlyTools: readonly string[];
	readonly setupAvailable?: boolean;
	readonly setupDescription?: string;
	readonly inboundPrep?: PluginInboundPrep;
	readonly icon?: string;
	readonly iconAsset?: PluginIconAsset;
	readonly launchUrl?: string;
	readonly inboundTransport?: string;
};

/**
 * Forward plugin stderr lines to the daemon log.
 * Plugins write structured JSON log lines to stderr; each line is parsed
 * and forwarded to `daemonLog` with category "plugin".
 */
export function forwardPluginStderr(pluginName: string, stderr: string): void {
	const trimmed = stderr.trim();
	if (!trimmed) return;
	for (const line of trimmed.split("\n")) {
		const text = line.trim();
		if (!text) continue;
		try {
			const entry = JSON.parse(text) as {
				level?: string;
				event?: string;
				data?: Record<string, unknown>;
			};
			const level = (entry.level ?? "info") as
				| "debug"
				| "info"
				| "warn"
				| "error";
			daemonLog(level, "plugin", entry.event ?? "plugin_log", {
				plugin: pluginName,
				...(entry.data ?? {}),
			});
		} catch {
			// Non-JSON stderr — log as debug
			daemonLog("debug", "plugin", "plugin_stderr", {
				plugin: pluginName,
				text: text.slice(0, 200),
			});
		}
	}
}

function readPluginConfig(
	creds: CredentialsFile,
	name: string,
): Record<string, unknown> {
	const block = creds.integrations?.[name];
	if (!block || typeof block !== "object") {
		return {};
	}
	return { ...block };
}

function readPluginState(name: string): Record<string, unknown> {
	const config = readConfig();
	const block = config.integrations?.[name];
	if (!block || typeof block !== "object") {
		return {};
	}
	return { ...block };
}

function buildEnvelope(name: string): PluginConfigEnvelope {
	const creds = readCredentials();
	return {
		config: readPluginConfig(creds, name),
		state: readPluginState(name),
	};
}

function pluginStatusReportsConnected(data: {
	readonly ok: boolean;
	readonly connected?: boolean;
}): boolean {
	return data.ok && data.connected === true;
}

function pluginHasCredentialFields(target: PluginInvocationTarget): boolean {
	const shape = pluginConfigShape(target);
	if (!shape.ok || !shape.data.ok) {
		return true;
	}
	return (shape.data.fields ?? []).length > 0;
}

function pluginConnectHint(
	name: string,
	target: PluginInvocationTarget,
	creds: CredentialsFile,
): string {
	if (!pluginHasCredentialFields(target)) {
		return `Run \`toby connect ${name}\` on this Mac.`;
	}

	const configBlock = creds.integrations?.[name];
	const hasConfig = Boolean(configBlock && Object.keys(configBlock).length > 0);
	return hasConfig
		? `Run \`toby connect ${name}\` after configuring credentials.`
		: `Configure credentials in \`toby configure\`, then run \`toby connect ${name}\`.`;
}

export function isPluginConnectedFromStatus(
	name: string,
	target: PluginInvocationTarget,
): boolean {
	const config = readConfig();
	if (config.integrations[name]?.connectedAt) {
		return true;
	}

	const result = pluginStatus(target, buildEnvelope(name));
	forwardPluginStderr(name, result.stderr);
	return result.ok && pluginStatusReportsConnected(result.data);
}

async function isPluginConnectedFromStatusAsync(
	name: string,
	target: PluginInvocationTarget,
): Promise<boolean> {
	const config = readConfig();
	if (config.integrations[name]?.connectedAt) {
		return true;
	}

	const result = await pluginStatusAsync(target, buildEnvelope(name));
	forwardPluginStderr(name, result.stderr);
	return result.ok && pluginStatusReportsConnected(result.data);
}

export function mergePluginConfigPatch(
	name: string,
	patch: Record<string, unknown> | undefined,
): void {
	if (!patch || Object.keys(patch).length === 0) {
		return;
	}

	const creds = readCredentials();
	const previous = creds.integrations?.[name] ?? {};
	const nextBlock: Record<string, string> = {};

	for (const [key, value] of Object.entries(previous)) {
		nextBlock[key] = String(value);
	}

	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined || value === null) continue;
		nextBlock[key] = String(value);
	}

	writeCredentials({
		...creds,
		integrations: {
			...(creds.integrations ?? {}),
			[name]: nextBlock,
		},
	});
}

function namespacedKey(pluginName: string, fieldKey: string): string {
	const prefix = `${pluginName}.`;
	if (fieldKey.startsWith(prefix)) {
		return fieldKey;
	}
	return `${pluginName}.${fieldKey}`;
}

function localKey(pluginName: string, namespaced: string): string {
	const prefix = `${pluginName}.`;
	let local = namespaced.startsWith(prefix)
		? namespaced.slice(prefix.length)
		: namespaced;
	if (local.startsWith(prefix)) {
		local = local.slice(prefix.length);
	}
	return local;
}

function substituteTemplate(
	template: string,
	vars: Record<string, string>,
): string {
	return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
		return vars[key] ?? "";
	});
}

function buildPluginChatModelPrep(
	metadata: PluginMetadata,
): NonNullable<IntegrationModule["chatModelPrep"]> {
	const prep = metadata.chatModelPrep;
	if (!prep) {
		throw new Error(
			`Plugin "${metadata.name}" declares chat capability but status.chatModelPrep is missing`,
		);
	}

	return {
		systemPromptSection: prep.systemPromptSection,
		async buildSingleSessionMessages(persona: Persona, userPrompt: string) {
			const base = `${prep.singleSessionRules.trim()}\n${globalChatToolsPromptSection(undefined, persona)}`;
			const systemContent = composeSystemPromptWithPersona(base, persona);
			const messages: Array<{ role: "system" | "user"; content: string }> = [
				{ role: "system", content: systemContent },
			];

			const trimmed = userPrompt.trim();
			if (trimmed) {
				const userTemplate =
					prep.singleSessionUserTemplate ?? "User request:\n{{userPrompt}}";
				messages.push({
					role: "user",
					content: substituteTemplate(userTemplate, {
						userPrompt: trimmed,
					}),
				});
			} else {
				messages.push({
					role: "user",
					content: "Follow the system instruction.",
				});
			}

			return messages;
		},
		async buildMultiUserContent(userPrompt: string) {
			const trimmed = userPrompt.trim();
			return substituteTemplate(prep.multiUserContentTemplate, {
				userPrompt:
					trimmed || "(no additional text — follow the system instruction.)",
			});
		},
	};
}

export function loadPluginMetadata(
	discovered: DiscoveredPlugin,
): PluginMetadata | { error: string; code: string } {
	const parsedName = parsePluginNameFromBinary(discovered.binaryName);
	if (!parsedName) {
		return {
			error: `Invalid plugin binary name: ${discovered.binaryName}`,
			code: "invalid_name",
		};
	}

	let target: PluginInvocationTarget;
	try {
		target = resolvePluginTarget(discovered);
	} catch (err) {
		return {
			error: (err as Error).message,
			code: "runtime_not_found",
		};
	}

	const statusResult = pluginStatus(target);
	if (!statusResult.ok) {
		return {
			error: statusResult.error,
			code: statusResult.code,
		};
	}

	const status = statusResult.data;
	if (!status.ok) {
		return {
			error: status.error ?? "Plugin status returned ok:false",
			code: status.code ?? "status_failed",
		};
	}

	if (!status.name || !status.displayName || !status.description) {
		return {
			error: "Plugin status missing required identity fields",
			code: "invalid_status",
		};
	}

	if (status.name !== parsedName) {
		return {
			error: `Plugin name mismatch: binary implies "${parsedName}" but status reports "${status.name}"`,
			code: "name_mismatch",
		};
	}

	if (
		!status.protocolVersion ||
		!isSupportedProtocolVersion(status.protocolVersion)
	) {
		return {
			error: `Unsupported plugin protocol version: ${status.protocolVersion ?? "(missing)"}`,
			code: "unsupported_protocol",
		};
	}

	const capabilities: IntegrationModule["capabilities"] =
		status.capabilities !== undefined ? [...status.capabilities] : ["chat"];
	if (capabilities.includes("chat") && !status.chatModelPrep) {
		return {
			error: `Plugin "${status.name}" declares chat capability but status.chatModelPrep is missing`,
			code: "missing_chat_model_prep",
		};
	}

	return {
		target,
		name: status.name,
		displayName: status.displayName,
		description: status.description,
		version: status.version ?? "0.0.0",
		protocolVersion: status.protocolVersion,
		capabilities,
		providerCategories: status.providerCategories,
		resources: status.resources,
		authMethods: status.authMethods,
		chatModelPrep: status.chatModelPrep,
		readOnlyTools: loadReadOnlyToolNames(target, {
			version: status.version ?? "0.0.0",
			protocolVersion: status.protocolVersion,
		}),
		setupAvailable: status.setupAvailable,
		setupDescription: status.setupDescription,
		inboundPrep: status.inboundPrep,
		icon: status.icon,
		iconAsset: status.iconAsset,
		launchUrl: status.launchUrl,
		inboundTransport: status.inboundTransport,
	};
}

function loadReadOnlyToolNames(
	target: PluginInvocationTarget,
	metadata?: { readonly version: string; readonly protocolVersion: string },
): string[] {
	let tools: NonNullable<PluginToolsListResponse["tools"]> | null = null;
	if (metadata) {
		tools = getCachedPluginToolDefinitions({
			target,
			version: metadata.version,
			protocolVersion: metadata.protocolVersion,
		});
	}
	if (!tools) {
		const toolsResult = pluginToolsList(target);
		if (!toolsResult.ok || !toolsResult.data.ok || !toolsResult.data.tools) {
			return [];
		}
		tools = toolsResult.data.tools;
		if (metadata) {
			setCachedPluginToolDefinitions({
				target,
				version: metadata.version,
				protocolVersion: metadata.protocolVersion,
				tools,
			});
		}
	}
	registerPluginToolLabels(tools);
	return tools.filter((t) => t.readOnly).map((t) => t.name);
}

async function resolvePluginChatReadiness(
	target: PluginInvocationTarget,
	name: string,
	creds: CredentialsFile,
): Promise<{ ok: boolean; hint?: string }> {
	const envelope: PluginConfigEnvelope = {
		config: readPluginConfig(creds, name),
		state: readPluginState(name),
	};
	const statusResult = await pluginStatusAsync(target, envelope);
	forwardPluginStderr(name, statusResult.stderr);
	if (!statusResult.ok || !statusResult.data.ok) {
		return {
			ok: false,
			hint: pluginConnectHint(name, target, creds),
		};
	}

	if (statusResult.data.chatReadiness) {
		return statusResult.data.chatReadiness;
	}

	// No explicit chatReadiness from the plugin — require a formal connect.
	// Defaulting to ok:true would make unconnected plugins (e.g. sample-ts)
	// appear in connectedIntegrations and falsely complete the onboarding step.
	return {
		ok: false,
		hint: pluginConnectHint(name, target, creds),
	};
}

/**
 * Resolve which standard tool (if any) this plugin exposes for a given
 * standard tool ID. Loads tool definitions from cache or via `tools list`.
 */
function findStandardToolName(
	metadata: PluginMetadata,
	standardToolId: string,
): string | null {
	const cachedTools = getCachedPluginToolDefinitions({
		target: metadata.target,
		version: metadata.version,
		protocolVersion: metadata.protocolVersion,
	});
	let toolDefs: NonNullable<PluginToolsListResponse["tools"]>;
	if (cachedTools) {
		toolDefs = cachedTools;
	} else {
		const toolsResult = pluginToolsList(metadata.target);
		if (!toolsResult.ok || !toolsResult.data.ok || !toolsResult.data.tools) {
			return null;
		}
		toolDefs = toolsResult.data.tools;
		setCachedPluginToolDefinitions({
			target: metadata.target,
			version: metadata.version,
			protocolVersion: metadata.protocolVersion,
			tools: toolDefs,
		});
	}
	const match = toolDefs.find((t) => t.standardTool === standardToolId);
	return match?.name ?? null;
}

/**
 * Build a `dashboard.getSummary` hook for an installable plugin by finding
 * a tool tagged with the matching `standardTool` ID and invoking it through
 * the existing `tools execute` subprocess dispatch.
 */
function buildPluginDashboardHook(
	metadata: PluginMetadata,
): IntegrationModule["dashboard"] | undefined {
	const categories = metadata.providerCategories;
	if (!categories || categories.length === 0) return undefined;

	const standardToolIds = new Set<string>();
	for (const cat of categories) {
		const id = STANDARD_TOOL_FOR_CATEGORY[cat];
		if (id) standardToolIds.add(id);
	}
	if (standardToolIds.size === 0) return undefined;

	const { name, target } = metadata;

	return {
		async getSummary(params: {
			readonly limit?: number;
		}): Promise<DashboardSummaryResult> {
			// Find the first matching standard tool for this plugin.
			let toolName: string | null = null;
			for (const id of standardToolIds) {
				toolName = findStandardToolName(metadata, id);
				if (toolName) break;
			}
			if (!toolName) {
				return {
					count: 0,
					items: [],
					generatedAt: new Date().toISOString(),
				};
			}

			const envelope = buildEnvelope(name);
			const dataDir = ensurePluginDataDir(name);
			const execResult = await pluginToolsExecuteAsync(target, {
				tool: toolName,
				input: params.limit !== undefined ? { limit: params.limit } : {},
				config: envelope.config,
				state: envelope.state,
				dryRun: false,
				paths: { dataDir },
			});

			forwardPluginStderr(name, execResult.stderr);

			if (!execResult.ok || !execResult.data.ok) {
				daemonLog("warn", "plugin", "dashboard_tool_exec_failed", {
					plugin: name,
					tool: toolName,
					error: !execResult.ok
						? execResult.error
						: (execResult.data.error ?? "Tool execution failed"),
				});
				return {
					count: 0,
					items: [],
					generatedAt: new Date().toISOString(),
				};
			}

			const result = execResult.data.result;
			const validated = validateDashboardSummary(result, name);
			if (!validated) {
				return {
					count: 0,
					items: [],
					generatedAt: new Date().toISOString(),
				};
			}
			return validated;
		},
	};
}

export function createPluginIntegrationModule(
	metadata: PluginMetadata,
): IntegrationModule {
	const { name, target } = metadata;
	const chatModelPrep = metadata.capabilities.includes("chat")
		? buildPluginChatModelPrep(metadata)
		: undefined;

	const lifecycle = {
		name,
		displayName: metadata.displayName,
		description: metadata.description,
		icon: metadata.icon,
		...(metadata.iconAsset ? { iconUrl: pluginIconUrl(metadata.name) } : {}),
		...(metadata.launchUrl ? { launchUrl: metadata.launchUrl } : {}),
		inboundTransport: metadata.inboundTransport,

		async connect(): Promise<void> {
			const envelope = buildEnvelope(name);
			const config = readConfig();
			if (config.integrations[name]?.connectedAt) {
				console.log(
					chalk.yellow(
						`${metadata.displayName} is already connected. Disconnect first to reconnect.`,
					),
				);
				return;
			}

			const result = pluginConnect(target, envelope);
			forwardPluginStderr(name, result.stderr);
			if (!result.ok) {
				throw new Error(result.error);
			}
			if (!result.data.ok) {
				throw new Error(
					result.data.reason ?? result.data.error ?? "Connect failed",
				);
			}

			mergePluginConfigPatch(name, result.data.config);

			config.integrations[name] = {
				...(config.integrations[name] ?? {}),
				connectedAt: new Date().toISOString(),
				pluginVersion: metadata.version,
			};
			writeConfig(config);

			const syncEnvelope = buildEnvelope(name);
			const sync = pluginConfigSet(target, syncEnvelope);
			forwardPluginStderr(name, sync.stderr);
			if (!sync.ok) {
				console.log(
					chalk.yellow(`Warning: plugin config sync failed: ${sync.error}`),
				);
			} else if (!sync.data.ok) {
				console.log(
					chalk.yellow(
						`Warning: plugin config sync failed: ${sync.data.reason ?? sync.data.error ?? "unknown"}`,
					),
				);
			} else {
				mergePluginConfigPatch(name, sync.data.config);
			}

			console.log(
				chalk.green(`${metadata.displayName} connected successfully!`),
			);
			clearSessionToolBundleCache();
		},

		async isConnected(): Promise<boolean> {
			return isPluginConnectedFromStatusAsync(name, target);
		},

		async testConnection(options?: TestConnectionOptions) {
			const connected = await lifecycle.isConnected();
			if (!connected) {
				const creds = readCredentials();
				return {
					ok: false,
					details: `${metadata.displayName} is not connected. ${pluginConnectHint(name, target, creds)}`,
				};
			}

			const envelope: PluginConfigEnvelope = {
				...buildEnvelope(name),
				validateTools: options?.validateTools,
			};
			const statusResult = await pluginStatusAsync(target, envelope);
			forwardPluginStderr(name, statusResult.stderr);
			if (!statusResult.ok) {
				return {
					ok: false,
					details: `Plugin status failed: ${statusResult.error}`,
				};
			}
			if (!statusResult.data.ok) {
				return {
					ok: false,
					details:
						statusResult.data.error ?? "Plugin reported unhealthy status",
				};
			}

			if (!options?.validateTools) {
				return {
					ok: true,
					details:
						statusResult.data.details ?? `${metadata.displayName} is healthy.`,
				};
			}

			const toolChecks: IntegrationToolHealth[] = (
				statusResult.data.tools ?? []
			).map((t) => ({
				tool: t.tool,
				ok: t.ok,
				details: t.details ?? "",
			}));

			if (toolChecks.length === 0) {
				const toolsResult = pluginToolsList(target);
				if (!toolsResult.ok) {
					return {
						ok: true,
						details: `Connected, but tool list failed: ${toolsResult.error}`,
					};
				}
				if (!toolsResult.data.ok || !toolsResult.data.tools) {
					return {
						ok: true,
						details: "Connected, but plugin returned no tools.",
					};
				}

				return {
					ok: true,
					details: `Connected with ${toolsResult.data.tools.length} tool(s) available.`,
					tools: toolsResult.data.tools.map((t) => ({
						tool: t.name,
						ok: true,
						details: t.readOnly
							? "Read-only tool available."
							: "Mutating tool available.",
					})),
				};
			}

			const failedChecks = toolChecks.filter((c) => !c.ok);
			return {
				ok: failedChecks.length === 0,
				details:
					failedChecks.length === 0
						? (statusResult.data.details ??
							`Successfully authenticated and validated ${toolChecks.length}/${toolChecks.length} tools.`)
						: (statusResult.data.details ??
							`Connected, but ${failedChecks.length}/${toolChecks.length} tool checks failed.`),
				tools: toolChecks,
			};
		},

		async disconnect(): Promise<void> {
			const config = readConfig();
			if (!config.integrations[name]) {
				console.log(chalk.yellow(`${metadata.displayName} is not connected.`));
				return;
			}

			const envelope = buildEnvelope(name);
			const result = pluginDisconnect(target, envelope);
			forwardPluginStderr(name, result.stderr);
			if (!result.ok) {
				throw new Error(result.error);
			}
			if (!result.data.ok) {
				throw new Error(
					result.data.reason ?? result.data.error ?? "Disconnect failed",
				);
			}

			mergePluginConfigPatch(name, result.data.config);

			Reflect.deleteProperty(config.integrations, name);
			writeConfig(config);
			console.log(chalk.green(`${metadata.displayName} disconnected.`));
			clearSessionToolBundleCache();
		},
	};

	function getCredentialDescriptors(): CredentialFieldDescriptor[] {
		const shapeResult = pluginConfigShape(target);
		if (!shapeResult.ok || !shapeResult.data.ok || !shapeResult.data.fields) {
			return [];
		}

		return shapeResult.data.fields.map((field) => {
			const descriptor: CredentialFieldDescriptor = {
				key: namespacedKey(name, field.key),
				label: field.label,
				masked: field.masked,
				multiline: field.multiline,
				showForAuthMethods: field.showForAuthMethods,
				showForInbound: field.showForInbound,
				group: field.group,
			};
			if (field.type === "select" && field.options?.length) {
				return {
					...descriptor,
					kind: "select" as const,
					options: field.options,
				};
			}
			return descriptor;
		});
	}

	function seedCredentialValues(
		creds: CredentialsFile,
	): Record<string, string> {
		const out: Record<string, string> = {};
		const block = creds.integrations?.[name];
		if (!block) return out;

		const prefix = `${name}.`;
		for (const [key, value] of Object.entries(block)) {
			if (value === undefined || value === null) continue;
			const local = key.startsWith(prefix) ? key.slice(prefix.length) : key;
			out[namespacedKey(name, local)] = String(value);
		}
		return out;
	}

	function mergeCredentialsPatch(
		values: Record<string, string>,
		previous: CredentialsFile,
	): Partial<CredentialsFile> {
		const previousBlock = previous.integrations?.[name] ?? {};
		const nextBlock: Record<string, string> = {};

		for (const [key, value] of Object.entries(previousBlock)) {
			nextBlock[key] = String(value);
		}

		const prefix = `${name}.`;
		for (const [key, value] of Object.entries(values)) {
			if (!key.startsWith(prefix)) continue;
			nextBlock[localKey(name, key)] = value;
		}

		// Return only this plugin's block. Spreading the full previous integrations bag
		// caused later modules (alphabetically after this one) to clobber earlier
		// credential updates with stale on-disk values during configure save.
		return {
			integrations: {
				[name]: nextBlock,
			},
		};
	}

	async function createChatTools(params: {
		readonly dryRun: boolean;
		readonly maxResults?: number;
	}) {
		const appliedActions: string[] = [];
		const cachedTools = getCachedPluginToolDefinitions({
			target,
			version: metadata.version,
			protocolVersion: metadata.protocolVersion,
		});
		let toolDefs: NonNullable<PluginToolsListResponse["tools"]>;
		if (cachedTools) {
			toolDefs = cachedTools;
		} else {
			const toolsResult = pluginToolsList(target);
			if (!toolsResult.ok || !toolsResult.data.ok || !toolsResult.data.tools) {
				return { tools: {}, appliedActions };
			}
			toolDefs = toolsResult.data.tools;
			setCachedPluginToolDefinitions({
				target,
				version: metadata.version,
				protocolVersion: metadata.protocolVersion,
				tools: toolDefs,
			});
		}

		registerPluginToolLabels(toolDefs);

		const tools: Record<string, Tool> = {};
		for (const definition of toolDefs) {
			const inputSchema = jsonSchemaToZod(definition.inputSchema);
			tools[definition.name] = tool({
				description: definition.description,
				inputSchema,
				execute: async (input) => {
					const envelope = buildEnvelope(name);
					const dataDir = ensurePluginDataDir(name);
					const execResult = await pluginToolsExecuteAsync(target, {
						tool: definition.name,
						input: input as Record<string, unknown>,
						config: envelope.config,
						state: envelope.state,
						dryRun: params.dryRun,
						paths: { dataDir },
					});

					forwardPluginStderr(name, execResult.stderr);

					if (!execResult.ok) {
						daemonLog("error", "plugin", "plugin_tool_exec_failed", {
							plugin: name,
							tool: definition.name,
							error: execResult.error,
							code: execResult.code,
						});
						return { error: execResult.error };
					}
					if (!execResult.data.ok) {
						daemonLog("error", "plugin", "plugin_tool_exec_error", {
							plugin: name,
							tool: definition.name,
							error: execResult.data.error ?? "Tool execution failed",
						});
						return { error: execResult.data.error ?? "Tool execution failed" };
					}

					mergePluginConfigPatch(name, execResult.data.config);

					if (execResult.data.appliedActions?.length) {
						appliedActions.push(...execResult.data.appliedActions);
					}

					return execResult.data.result ?? { ok: true };
				},
			});
		}

		return { tools, appliedActions };
	}

	async function chat(options: ChatRunOptions): Promise<void> {
		const persona = options.personaForModel;
		const dryRun = options.dryRun;

		console.log(
			chalk.cyan(`${metadata.displayName} chat (persona "${persona.name}")...`),
		);
		if (dryRun) {
			console.log(chalk.yellow("  (dry run - changes will not be applied)"));
		}
		console.log(chalk.dim(`  Goal: ${options.prompt}`));
		console.log();

		if (!chatModelPrep) {
			throw new Error(
				`Plugin "${name}" does not support chat (missing chatModelPrep)`,
			);
		}

		const messages = await chatModelPrep.buildSingleSessionMessages(
			persona,
			options.prompt,
		);
		const module = createPluginIntegrationModule(metadata);
		const result = await runSharedChatTurn([module], messages, {
			persona,
			dryRun,
		});

		for (const line of result.appliedActions) {
			console.log(chalk.green(`+ ${line}`));
		}

		if (result.text?.trim()) {
			console.log();
			console.log(chalk.bold("Result"));
			console.log(result.text.trim());
		}

		console.log();
		console.log(chalk.green("Done."));
	}

	const dashboardHook = buildPluginDashboardHook(metadata);

	return {
		...lifecycle,
		capabilities: metadata.capabilities,
		providerCategories: metadata.providerCategories,
		resources: metadata.resources,
		authMethods: metadata.authMethods,
		getCredentialDescriptors,
		seedCredentialValues,
		mergeCredentialsPatch,
		createChatTools,
		chat,
		chatReadiness: async (creds: CredentialsFile) => {
			if (await lifecycle.isConnected()) return { ok: true };
			return resolvePluginChatReadiness(target, name, creds);
		},
		...(chatModelPrep ? { chatModelPrep } : {}),
		...(dashboardHook ? { dashboard: dashboardHook } : {}),
		...(metadata.capabilities.includes("inbound")
			? {
					chatInbound: createPluginChatInboundProvider({
						target,
						integrationName: name,
						buildEnvelope: () => {
							const envelope = buildEnvelope(name);
							return {
								config: envelope.config ?? {},
								state: envelope.state ?? {},
							};
						},
					}),
				}
			: {}),
	};
}

export function getPluginReadOnlyToolNames(
	metadata: PluginMetadata,
): readonly string[] {
	return metadata.readOnlyTools;
}

/** Exposed for plugin diagnostics and `toby plugins` commands. */
export function getPluginMetadataRecord(): Map<string, PluginMetadata> {
	return pluginMetadataCache;
}

export function rememberPluginMetadata(metadata: PluginMetadata): void {
	pluginMetadataCache.set(metadata.name, metadata);
}

const pluginMetadataCache = new Map<string, PluginMetadata>();

/** Lookup a plugin metadata entry (includes load errors via doctor command). */
export function inspectPluginBinary(
	discovered: DiscoveredPlugin,
): PluginMetadata | { error: string; code: string; binaryName: string } {
	const loaded = loadPluginMetadata(discovered);
	if ("error" in loaded) {
		return { ...loaded, binaryName: discovered.binaryName };
	}
	rememberPluginMetadata(loaded);
	return loaded;
}
