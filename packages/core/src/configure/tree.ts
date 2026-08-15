import type { AIProviderForUI } from "../ai/model-list";
import { formatModelChoiceLabel } from "../ai/model-list";
import { AI_PROVIDERS } from "../ai/providers";
import {
	WEB_SEARCH_PROVIDERS,
	getWebSearchProvider,
} from "../ai/web-search-providers";
import { getDefaultPersonaName } from "../config/index";
import { listFlowRecords } from "../flows/definition-store";
import {
	getIntegrationModules,
	getModulesForCategory,
} from "../integrations/index";
import {
	ALL_PROVIDER_CATEGORIES,
	PROVIDER_CATEGORY_DESCRIPTIONS,
	PROVIDER_CATEGORY_LABELS,
	type ProviderCategory,
} from "../integrations/types";
import {
	TRANSCRIPTION_PROVIDERS,
	getTranscriptionProvider,
	resolveTranscriptionApiKey,
} from "../listen/transcription-providers";
import { isBuiltInPersonaName } from "../personas/index";
import { listProjects } from "../projects/index";
import { cronToHuman } from "../schedules/cron-human";
import { listScheduleRuns, listSchedules } from "../schedules/store";
import { NONE_SCHEDULE_FLOW_ID, scheduleRunsFlow } from "../schedules/types";
import type { ConfigureTreeContext, SettingsItem } from "./types";
import {
	ADD_CUSTOM_MODEL_SENTINEL,
	DEFAULT_CONFIGURE_TREE_CONTEXT,
} from "./types";

export type { ConfigureTreeContext, SettingsItem } from "./types";
export { ADD_CUSTOM_MODEL_SENTINEL, CONFIGURE_TREE_ACTION_KEYS } from "./types";

const MAX_PERSONA_INSTRUCTION_PREVIEW = 120;

function truncateSkillPreview(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Build the credential/configure field children for a single AI provider.
 * Most providers expose a single API key; Ollama also has a configurable base URL.
 */
function buildAIProviderChildren(
	providerId: string,
	values: Record<string, string>,
): SettingsItem[] {
	switch (providerId) {
		case "openai":
			return [
				{
					kind: "value",
					key: "ai.openai.token",
					label: "API Token",
					masked: true,
				},
			];
		case "ollama":
			return [
				{
					kind: "value",
					key: "ai.ollama.baseUrl",
					label: "Base URL",
					currentValue:
						values["ai.ollama.baseUrl"] ?? "http://localhost:11434/v1",
				},
				{
					kind: "value",
					key: "ai.ollama.apiKey",
					label: "API Key (optional)",
					masked: true,
				},
			];
		default:
			return [
				{
					kind: "value",
					key: `ai.${providerId}.apiKey`,
					label: "API Key",
					masked: true,
				},
			];
	}
}

/** Build the AI section with sub-sections for every registered provider. */
function buildAIProviderSections(
	values: Record<string, string>,
): SettingsItem[] {
	return AI_PROVIDERS.map((provider) => ({
		label: provider.displayName,
		kind: "section" as const,
		key: `ai.${provider.id}`,
		...(provider.iconUrl ? { iconUrl: provider.iconUrl } : {}),
		...(provider.description ? { description: provider.description } : {}),
		...(provider.docUrl ? { docUrl: provider.docUrl } : {}),
		children: buildAIProviderChildren(provider.id, values),
	}));
}

export function buildSettingsTree(
	personas: {
		name: string;
		ai: { provider: string; model: string };
		instructions: string;
		promptMode: "add" | "replace";
		imagePath?: string;
	}[],
	availableProviders: AIProviderForUI[],
	values: Record<string, string> = {},
	defaultProviders?: Partial<Record<ProviderCategory, string>>,
	treeContext: Partial<ConfigureTreeContext> = {},
): SettingsItem {
	const ctx: ConfigureTreeContext = {
		...DEFAULT_CONFIGURE_TREE_CONTEXT,
		...treeContext,
	};
	const integrationSections: SettingsItem[] = getIntegrationModules().map(
		(mod) => {
			const authMethods = mod.authMethods ?? [];
			const authMethodKey = `${mod.name}.authMethod`;
			const defaultAuthMethod =
				authMethods.find((method) => method.isDefault)?.id ??
				authMethods[0]?.id;
			const selectedAuthMethod = values[authMethodKey] ?? defaultAuthMethod;

			const authSelect: SettingsItem[] =
				authMethods.length > 0
					? [
							{
								label: "Auth Method",
								kind: "select" as const,
								key: authMethodKey,
								options: authMethods.map((method) => method.id),
								currentValue: selectedAuthMethod,
							},
						]
					: [];

			const inboundActive =
				values["chatInbound.enabled"] === "true" &&
				(values["chatInbound.integration"] ?? "(none)") === mod.name;
			const integrationInboundOn =
				values[`${mod.name}.inboundEnabled`] === "true";
			const showInboundCredentials =
				Boolean(mod.chatInbound) && (inboundActive || integrationInboundOn);

			const credentialItems = mod
				.getCredentialDescriptors()
				.filter((d) => {
					if (d.showForInbound && showInboundCredentials) {
						return true;
					}
					if (!d.showForAuthMethods || d.showForAuthMethods.length === 0) {
						return true;
					}
					if (!selectedAuthMethod) return false;
					return d.showForAuthMethods.includes(selectedAuthMethod);
				})
				.map((d) => ({
					label: d.label,
					kind: d.kind ?? "value",
					key: d.key,
					options: d.options ? [...d.options] : undefined,
					masked: d.masked,
					multiline: d.multiline,
					group: d.group,
				}));

			const globalInboundForMod =
				values["chatInbound.enabled"] === "true" &&
				(values["chatInbound.integration"] ?? "(none)") === mod.name;
			const inboundItems: SettingsItem[] = mod.chatInbound
				? [
						{
							label: "Daemon: listen for @mentions",
							kind: "select" as const,
							key: `${mod.name}.inboundEnabled`,
							options: ["false", "true"],
							selectChoices: [
								{ value: "false", label: "Off" },
								{ value: "true", label: "On" },
							],
							currentValue:
								values[`${mod.name}.inboundEnabled`] === "true" ||
								globalInboundForMod
									? "true"
									: "false",
						},
					]
				: [];

			const configChildren: SettingsItem[] = [
				...authSelect,
				...credentialItems,
				...inboundItems,
			];
			if (configChildren.length === 0) {
				configChildren.push({
					label:
						mod.configureHint ??
						"No configuration options for this integration.",
					kind: "hint",
					key: `${mod.name}._hint`,
				});
			}

			return {
				label: mod.displayName,
				kind: "section" as const,
				key: mod.name,
				icon: mod.icon,
				iconUrl: mod.iconUrl,
				children: configChildren,
			};
		},
	);

	const currentDefault = getDefaultPersonaName();

	const personaItems: SettingsItem[] = personas.map((p) => {
		const isBuiltIn = isBuiltInPersonaName(p.name);
		const providerId =
			values[`personas.${p.name}.ai.provider`] ?? p.ai.provider;
		const modelValue = values[`personas.${p.name}.ai.model`] ?? p.ai.model;
		const providerInfo = availableProviders.find((pr) => pr.id === providerId);

		// providerInfo.models is already the live (or curated) catalog from
		// resolveAIProvidersForUI, including any customModels not in that list.
		// Only ensure the currently selected model is present.
		const modelItems = [...(providerInfo?.models ?? [])];
		if (modelValue && !modelItems.some((m) => m.id === modelValue)) {
			modelItems.push({ id: modelValue });
		}
		const modelOptions = modelItems.map((m) => m.id);
		const modelSelectChoices = modelItems.map((m) => ({
			value: m.id,
			label: formatModelChoiceLabel(m),
		}));
		if (providerInfo?.allowCustomModel) {
			modelOptions.push(ADD_CUSTOM_MODEL_SENTINEL);
			modelSelectChoices.push({
				value: ADD_CUSTOM_MODEL_SENTINEL,
				label: "+ Add custom model…",
			});
		}

		const aiModelItems: SettingsItem[] = [
			{
				label: "AI Provider",
				kind: "select" as const,
				key: `personas.${p.name}.ai.provider`,
				navKey: `personas.${p.name}.ai.provider`,
				selectChoices: availableProviders.map((pr) => ({
					value: pr.id,
					label: pr.displayName,
				})),
				options: availableProviders.map((pr) => pr.id),
				currentValue: providerId,
			},
			{
				label: "AI Model",
				kind: "select" as const,
				key: `personas.${p.name}.ai.model`,
				navKey: `personas.${p.name}.ai.model.select`,
				options: modelOptions,
				selectChoices: modelSelectChoices,
				currentValue: modelValue,
			},
		];

		const labelPrefix = currentDefault === p.name ? "★ " : "";

		return {
			label: `${labelPrefix}${p.name}`,
			kind: "section" as const,
			key: `personas.${p.name}`,
			children: [
				{
					label: "Persona Image",
					kind: "image" as const,
					key: `personas.${p.name}.imagePath`,
					currentValue: p.imagePath ?? "",
				},
				{
					label: "Name",
					kind: isBuiltIn ? ("hint" as const) : ("value" as const),
					key: `personas.${p.name}.name`,
					currentValue: p.name,
				},
				{
					label: "Instructions",
					kind: isBuiltIn ? ("hint" as const) : ("value" as const),
					key: `personas.${p.name}.instructions`,
					currentValue: isBuiltIn
						? truncateSkillPreview(
								p.instructions.trim(),
								MAX_PERSONA_INSTRUCTION_PREVIEW,
							)
						: p.instructions,
					multiline: true,
				},
				{
					label: "Prompt Mode",
					kind: isBuiltIn ? ("hint" as const) : ("select" as const),
					key: `personas.${p.name}.promptMode`,
					options: ["add", "replace"],
					currentValue: p.promptMode,
				},
				...aiModelItems,
				...(currentDefault !== p.name
					? [
							{
								label: "Set as default",
								kind: "action" as const,
								key: `personas.${p.name}._setDefault`,
							},
						]
					: []),
				...(isBuiltIn
					? []
					: [
							{
								label: "Delete persona",
								kind: "delete" as const,
								key: `personas.${p.name}._delete`,
							},
						]),
			],
		};
	});

	const defaultProviderItems: SettingsItem[] = ALL_PROVIDER_CATEGORIES.map(
		(cat) => {
			const modules = getModulesForCategory(cat);
			const options = ["(none)", ...modules.map((m) => m.name)];
			const currentValue =
				defaultProviders?.[cat] ?? values[`defaults.${cat}`] ?? "(none)";
			return {
				label: PROVIDER_CATEGORY_LABELS[cat],
				kind: "select" as const,
				key: `defaults.${cat}`,
				options,
				selectChoices: [
					{ value: "(none)", label: "None" },
					...modules.map((m) => ({
						value: m.name,
						label: m.displayName,
					})),
				],
				currentValue,
				description: PROVIDER_CATEGORY_DESCRIPTIONS[cat],
			};
		},
	);

	const inboundIntegrationModules = getIntegrationModules().filter(
		(m) => m.chatInbound,
	);
	const inboundIntegrationOptions = [
		"(none)",
		...inboundIntegrationModules.map((m) => m.name),
	];
	const personaOptions = ["(default)", ...personas.map((p) => p.name)];

	const chatInboundSection: SettingsItem = {
		label: "Chat",
		kind: "section",
		key: "chatInbound",
		children: [
			{
				label: "Enable inbound chat",
				kind: "select",
				key: "chatInbound.enabled",
				options: ["false", "true"],
				selectChoices: [
					{ value: "false", label: "Off" },
					{ value: "true", label: "On" },
				],
				currentValue: values["chatInbound.enabled"] ?? "false",
			},
			{
				label: "Active integration",
				kind: "select",
				key: "chatInbound.integration",
				options: inboundIntegrationOptions,
				selectChoices: [
					{ value: "(none)", label: "None" },
					...inboundIntegrationModules.map((m) => ({
						value: m.name,
						label: m.displayName,
					})),
				],
				currentValue: values["chatInbound.integration"] ?? "(none)",
			},
			{
				label: "Persona for inbound turns",
				kind: "select",
				key: "chatInbound.persona",
				options: personaOptions,
				currentValue: values["chatInbound.persona"] ?? "(default)",
			},
		],
	};

	const transcriptionProviderId =
		values["transcription.provider"] ??
		TRANSCRIPTION_PROVIDERS[0]?.id ??
		"openai";
	const transcriptionProviderInfo = getTranscriptionProvider(
		transcriptionProviderId,
	);
	const transcriptionModelValue =
		values["transcription.model"] ??
		ctx.transcriptionCatalogModels?.[transcriptionProviderId]?.[0] ??
		transcriptionProviderInfo?.models[0] ??
		"";
	// Prefer catalog-supplied model list; fall back to the static built-in list.
	const baseModels =
		ctx.transcriptionCatalogModels?.[transcriptionProviderId] ??
		transcriptionProviderInfo?.models ??
		[];
	const transcriptionModelOptions = [
		...baseModels,
		...(transcriptionModelValue && !baseModels.includes(transcriptionModelValue)
			? [transcriptionModelValue]
			: []),
	];
	const transcriptionApiKeyAvailable =
		resolveTranscriptionApiKey(transcriptionProviderId) !== undefined;
	const providerLabel =
		transcriptionProviderInfo?.displayName ?? transcriptionProviderId;
	// Single status tip — avoid stacking a second provider-specific "needs key" hint.
	const transcriptionStatusHint = (() => {
		if (!values["transcription.provider"]?.trim()) {
			return "Choose a provider and model. OpenAI and Vercel can reuse AI keys; Groq and OpenRouter need their own API keys.";
		}
		if (!transcriptionApiKeyAvailable) {
			if (transcriptionProviderInfo?.reusesOpenAiToken) {
				return "OpenAI needs an API key — set AI → OpenAI, or paste a key below. Until a key is set, onboarding and recording treat transcription as not configured.";
			}
			if (transcriptionProviderInfo?.reusesVercelApiKey) {
				return "Vercel AI Gateway needs an API key — set AI → Vercel AI Gateway, or paste a key below. Until a key is set, onboarding and recording treat transcription as not configured.";
			}
			if (transcriptionProviderInfo?.reusesOpenRouterApiKey) {
				return "OpenRouter needs an API key — set AI → OpenRouter (or run guided setup), or paste a key below. Until a key is set, onboarding and recording treat transcription as not configured.";
			}
			return `${providerLabel} needs an API key — paste one below. Until a key is set, onboarding and recording treat transcription as not configured.`;
		}
		if (transcriptionProviderInfo?.reusesOpenAiToken) {
			return "Transcription is ready. OpenAI reuses your AI → OpenAI API token when no key is set here.";
		}
		if (transcriptionProviderInfo?.reusesVercelApiKey) {
			return "Transcription is ready. Vercel reuses your AI → Vercel API key (or AI_GATEWAY_API_KEY) when no key is set here.";
		}
		if (transcriptionProviderInfo?.reusesOpenRouterApiKey) {
			return "Transcription is ready. OpenRouter reuses your AI → OpenRouter API key (or OPENROUTER_API_KEY) when no key is set here.";
		}
		return `Transcription is ready to use with ${providerLabel}.`;
	})();

	const transcriptionSection: SettingsItem = {
		label: "Transcription",
		kind: "section",
		key: "transcription",
		children: [
			{
				label: transcriptionStatusHint,
				kind: "hint" as const,
				key: "transcription._status",
			},
			{
				label: "Provider",
				kind: "select" as const,
				key: "transcription.provider",
				navKey: "transcription.provider",
				options: TRANSCRIPTION_PROVIDERS.map((p) => p.id),
				selectChoices: TRANSCRIPTION_PROVIDERS.map((p) => ({
					value: p.id,
					label: p.displayName,
				})),
				currentValue: transcriptionProviderId,
			},
			{
				label: "Model",
				kind: "select" as const,
				key: "transcription.model",
				navKey: "transcription.model.select",
				options: transcriptionModelOptions,
				selectChoices: transcriptionModelOptions.map((m) => ({
					value: m,
					label: m,
				})),
				currentValue: transcriptionModelValue,
			},
			{
				label: "API Key",
				kind: "value" as const,
				key: `transcription.${transcriptionProviderId}.apiKey`,
				masked: true,
			},
			{
				label: "Persona for recording summaries",
				kind: "select" as const,
				key: "listen.summaryPersona",
				options: personaOptions,
				selectChoices: [
					{ value: "(default)", label: "Default persona" },
					...personas.map((p) => ({
						value: p.name,
						label: p.name,
					})),
				],
				currentValue: values["listen.summaryPersona"] ?? "(default)",
				description:
					"Persona used to summarize recording transcripts. Falls back to the default persona.",
			},
			{
				label: "Record microphone",
				kind: "select" as const,
				key: "listen.recordMic",
				options: ["true", "false"],
				selectChoices: [
					{ value: "true", label: "On" },
					{ value: "false", label: "Off" },
				],
				currentValue: values["listen.recordMic"] ?? "true",
				description:
					"Capture your microphone when using Record Audio. At least one of microphone or system audio must be on.",
			},
			{
				label: "Record system audio",
				kind: "select" as const,
				key: "listen.recordSystem",
				options: ["true", "false"],
				selectChoices: [
					{ value: "true", label: "On" },
					{ value: "false", label: "Off" },
				],
				currentValue: values["listen.recordSystem"] ?? "true",
				description:
					"Capture other apps (meetings, browser, music). With the mic on, combined audio is dual-mono stereo (mic left, system right)—not a summed mix.",
			},
		],
	};

	const webSearchProviderId =
		values["webSearch.provider"] ?? WEB_SEARCH_PROVIDERS[0]?.id ?? "ai-gateway";
	const webSearchProviderInfo = getWebSearchProvider(webSearchProviderId);
	const webSearchEnabled = values["webSearch.enabled"] === "true";
	const webSearchSection: SettingsItem = {
		label: "Web Search",
		kind: "section",
		key: "webSearch",
		children: [
			{
				label: "Provider",
				kind: "select" as const,
				key: "webSearch.provider",
				navKey: "webSearch.provider",
				options: WEB_SEARCH_PROVIDERS.map((p) => p.id),
				selectChoices: WEB_SEARCH_PROVIDERS.map((p) => ({
					value: p.id,
					label: p.displayName,
				})),
				currentValue: webSearchProviderId,
			},
			{
				label: "Enabled",
				kind: "select" as const,
				key: "webSearch.enabled",
				options: ["false", "true"],
				selectChoices: [
					{ value: "false", label: "Off" },
					{ value: "true", label: "On" },
				],
				currentValue: webSearchEnabled ? "true" : "false",
			},
			...(webSearchProviderInfo
				? [
						{
							label: webSearchProviderInfo.description,
							kind: "hint" as const,
							key: "webSearch._providerHint",
						},
					]
				: []),
		],
	};

	const weatherEnabled = values["weather.enabled"] === "true";
	const weatherTempUnit =
		values["weather.temperatureUnit"] === "fahrenheit"
			? "fahrenheit"
			: "celsius";
	const weatherSection: SettingsItem = {
		label: "Weather",
		kind: "section",
		key: "weather",
		children: [
			{
				label: "Enabled",
				kind: "select" as const,
				key: "weather.enabled",
				options: ["false", "true"],
				selectChoices: [
					{ value: "false", label: "Off" },
					{ value: "true", label: "On" },
				],
				currentValue: weatherEnabled ? "true" : "false",
			},
			{
				label: "Default location",
				kind: "value" as const,
				key: "weather.defaultLocation",
				description:
					"Used when chat does not specify a place (e.g. Seattle, WA).",
				currentValue: values["weather.defaultLocation"] ?? "",
			},
			{
				label: "Temperature unit",
				kind: "select" as const,
				key: "weather.temperatureUnit",
				options: ["celsius", "fahrenheit"],
				selectChoices: [
					{ value: "celsius", label: "Celsius (°C)" },
					{ value: "fahrenheit", label: "Fahrenheit (°F)" },
				],
				currentValue: weatherTempUnit,
			},
			{
				label: "Open-Meteo API key",
				kind: "value" as const,
				key: "weather.apiKey",
				masked: true,
				description:
					"Optional. Free tier works without a key. Paid/customer keys use customer-api.open-meteo.com.",
			},
			{
				label:
					"Weather via Open-Meteo (global). Place names are geocoded with Nominatim. Data: Open-Meteo CC BY 4.0.",
				kind: "hint" as const,
				key: "weather._hint",
			},
		],
	};

	let schedules = [] as ReturnType<typeof listSchedules>;
	try {
		schedules = listSchedules();
	} catch {
		schedules = [];
	}
	const projects = listProjects();
	const projectSelectChoices = [
		{ value: "(none)", label: "No project" },
		...projects.map((project) => ({
			value: project.id,
			label: project.name,
		})),
	];
	let flows: ReturnType<typeof listFlowRecords> = [];
	try {
		flows = listFlowRecords();
	} catch {
		flows = [];
	}
	const flowSelectChoices = [
		{ value: NONE_SCHEDULE_FLOW_ID, label: "Select a flow" },
		...flows.map((flow) => ({
			value: flow.id,
			label: flow.builtin ? `${flow.name} (built-in)` : flow.name,
		})),
	];
	const daemonRunning = ctx.daemonRunning;
	const activeScheduleCount = schedules.filter((s) => s.enabled).length;
	const scheduleSections: SettingsItem[] = schedules.map((schedule) => {
		let runs: ReturnType<typeof listScheduleRuns> = [];
		try {
			runs = listScheduleRuns(schedule.id, 5);
		} catch {
			runs = [];
		}
		const runItems: SettingsItem[] = runs.map((run) => ({
			label: `${new Date(run.startedAt).toLocaleString()} · ${run.status.toUpperCase()}`,
			kind: "action" as const,
			key: `schedules.${schedule.id}.runs.${run.id}`,
			currentValue: run.startedAt,
		}));

		return {
			label: `${schedule.name}${schedule.enabled ? "" : " (off)"}`,
			kind: "section" as const,
			key: `schedules.${schedule.id}`,
			children: [
				{
					label: "Name",
					kind: "value" as const,
					key: `schedules.${schedule.id}.name`,
					currentValue: schedule.name,
				},
				{
					label: "When it runs",
					kind: "select" as const,
					key: `schedules.${schedule.id}.action`,
					options: ["prompt", "flow"],
					currentValue: scheduleRunsFlow(schedule) ? "flow" : "prompt",
					selectChoices: [
						{ value: "prompt", label: "Prompt" },
						{ value: "flow", label: "Flow" },
					],
				},
				{
					label: "Flow",
					kind: "select" as const,
					key: `schedules.${schedule.id}.flow`,
					options: flowSelectChoices.map((choice) => choice.value),
					selectChoices: flowSelectChoices,
					currentValue: schedule.flowId ?? NONE_SCHEDULE_FLOW_ID,
				},
				{
					label: "Prompt",
					kind: "value" as const,
					key: `schedules.${schedule.id}.prompt`,
					currentValue: schedule.prompt,
					multiline: true,
				},
				{
					label: "Persona",
					kind: "select" as const,
					key: `schedules.${schedule.id}.persona`,
					options: personas.map((p) => p.name),
					currentValue: schedule.personaName,
				},
				{
					label: "Project",
					kind: "select" as const,
					key: `schedules.${schedule.id}.project`,
					options: projectSelectChoices.map((choice) => choice.value),
					selectChoices: projectSelectChoices,
					currentValue: schedule.projectId ?? "(none)",
				},
				{
					label: "Schedule",
					kind: "value" as const,
					key: `schedules.${schedule.id}.cron`,
					currentValue: `${schedule.cronExpression} (${cronToHuman(schedule.cronExpression)})`,
				},
				{
					label: "Enabled",
					kind: "select" as const,
					key: `schedules.${schedule.id}.enabled`,
					options: ["Yes", "No"],
					currentValue: schedule.enabled ? "Yes" : "No",
					selectChoices: [
						{ value: "Yes", label: "On" },
						{ value: "No", label: "Off" },
					],
				},
				{
					label: "Last run",
					kind: "hint" as const,
					key: `schedules.${schedule.id}._lastRun`,
					currentValue: schedule.lastRunAt
						? new Date(schedule.lastRunAt).toLocaleString()
						: "Never",
				},
				...(runs.length > 0
					? [
							{
								label: "Recent runs",
								kind: "hint" as const,
								key: `schedules.${schedule.id}._runsHeader`,
								currentValue: "",
							},
							...runItems,
						]
					: []),
				{
					label: "Run now",
					kind: "action" as const,
					key: `schedules.${schedule.id}._run`,
				},
				{
					label: "Delete schedule",
					kind: "delete" as const,
					key: `schedules.${schedule.id}._delete`,
				},
			],
		};
	});

	const schedulesSection: SettingsItem = {
		label: `Schedules${daemonRunning ? "" : " (daemon off)"}${
			activeScheduleCount > 0 ? ` · ${activeScheduleCount} active` : ""
		}`,
		kind: "section",
		key: "schedules",
		children: [
			{
				label: "Create schedule",
				kind: "action",
				key: "schedules._new",
			},
			...(scheduleSections.length > 0
				? scheduleSections
				: [
						{
							label: "No schedules yet.",
							kind: "hint" as const,
							key: "schedules._empty",
						},
					]),
		],
	};

	return {
		label: "Toby Configuration",
		kind: "section",
		key: "root",
		children: [
			{
				label: "Integrations",
				kind: "section",
				key: "integrations",
				children: integrationSections,
			},
			chatInboundSection,
			{
				label: "Default Providers",
				kind: "section",
				key: "defaults",
				children: defaultProviderItems,
			},
			{
				label: "AI",
				kind: "section",
				key: "ai",
				children: buildAIProviderSections(values),
			},
			{
				label: "Personas",
				kind: "section",
				key: "personas",
				children: [
					{
						label: "Add Persona",
						kind: "action",
						key: "personas._new",
					},
					...personaItems,
				],
			},
			transcriptionSection,
			webSearchSection,
			weatherSection,
			{
				label: "Dashboard",
				kind: "section" as const,
				key: "dashboard",
				children: [
					{
						label: "Persona for dashboard summaries",
						kind: "select" as const,
						key: "dashboard.persona",
						options: personaOptions,
						selectChoices: [
							{ value: "(default)", label: "Default persona" },
							...personas.map((p) => ({
								value: p.name,
								label: p.name,
							})),
						],
						currentValue: values["dashboard.persona"] ?? "(default)",
						description:
							"Persona used to summarize dashboard cards (email, tasks, calendar). Falls back to the default persona. Prefer a non-reasoning model for this persona — reasoning models often fail or time out on short structured summaries.",
					},
				],
			},
			schedulesSection,
		],
	};
}
