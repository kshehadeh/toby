import type { AIProviderInfo } from "../ai/providers";
import {
	WEB_SEARCH_PROVIDERS,
	getWebSearchProvider,
} from "../ai/web-search-providers";
import { getDefaultPersonaName } from "../config/index";
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
} from "../listen/transcription-providers";
import { DEFAULT_CHAT_PERSONA } from "../personas/index";
import {
	type Project,
	getActiveProjectSlug,
	listProjects,
} from "../projects/index";
import { cronToHuman } from "../schedules/cron-human";
import { listScheduleRuns, listSchedules } from "../schedules/store";
import { loadLocalSkills } from "../skills/index";
import {
	formatListenDuration,
	formatListenRecordingDate,
	listenRecordingTreeLabel,
} from "./format";
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

export function buildSettingsTree(
	personas: {
		name: string;
		ai: { provider: string; model: string };
		instructions: string;
		promptMode: "add" | "replace";
		imagePath?: string;
	}[],
	availableProviders: AIProviderInfo[],
	values: Record<string, string> = {},
	defaultProviders?: Partial<Record<ProviderCategory, string>>,
	treeContext: Partial<ConfigureTreeContext> = {},
): SettingsItem {
	const ctx: ConfigureTreeContext = {
		...DEFAULT_CONFIGURE_TREE_CONTEXT,
		...treeContext,
	};
	const listenRecordingsDir = ctx.listenRecordingsDir;
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
		const isBuiltIn = p.name === DEFAULT_CHAT_PERSONA.name;
		const providerId =
			values[`personas.${p.name}.ai.provider`] ?? p.ai.provider;
		const modelValue = values[`personas.${p.name}.ai.model`] ?? p.ai.model;
		const providerInfo = availableProviders.find((pr) => pr.id === providerId);

		const customModels = (values[`ai.customModels.${providerId}`] ?? "")
			.split("\n")
			.map((s) => s.trim())
			.filter(Boolean);
		const modelOptions = [
			...new Set([...(providerInfo?.models ?? []), ...customModels]),
		];
		if (modelValue && !modelOptions.includes(modelValue)) {
			modelOptions.push(modelValue);
		}
		const modelSelectChoices = modelOptions.map((m) => ({
			value: m,
			label: m,
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

	const recordingSections: SettingsItem[] = ctx.listenRecordings.map(
		(recording) => ({
			label: listenRecordingTreeLabel(
				recording.metadata.startedAt,
				recording.metadata.createdAt,
				recording.metadata.name,
				recording.id,
			),
			kind: "section" as const,
			key: `listen.recordings.${recording.id}`,
			children: [
				{
					label: "Name",
					kind: "value" as const,
					key: `listen.recordings.${recording.id}.name`,
					currentValue: recording.metadata.name ?? "",
				},
				{
					label: "Description",
					kind: "value" as const,
					key: `listen.recordings.${recording.id}.description`,
					currentValue: recording.metadata.description ?? "",
					multiline: true,
				},
				{
					label: "Location",
					kind: "hint" as const,
					key: `listen.recordings.${recording.id}._location`,
					currentValue: recording.dir,
				},
				{
					label: "Duration",
					kind: "hint" as const,
					key: `listen.recordings.${recording.id}._duration`,
					currentValue:
						formatListenDuration(recording.metadata.durationMs) || "N/A",
				},
				{
					label: "Date",
					kind: "hint" as const,
					key: `listen.recordings.${recording.id}._date`,
					currentValue: formatListenRecordingDate(
						recording.metadata.startedAt || recording.metadata.createdAt,
					),
				},
				{
					label: "Sources",
					kind: "hint" as const,
					key: `listen.recordings.${recording.id}._sources`,
					currentValue: ctx.formatListenSources(recording.metadata.sources),
				},
				{
					label: "Open folder in Finder",
					kind: "action" as const,
					key: `listen.recordings.${recording.id}._open`,
				},
				{
					label: "Delete recording",
					kind: "delete" as const,
					key: `listen.recordings.${recording.id}._delete`,
				},
			],
		}),
	);

	const transcriptionProviderId =
		values["transcription.provider"] ??
		TRANSCRIPTION_PROVIDERS[0]?.id ??
		"openai";
	const transcriptionProviderInfo = getTranscriptionProvider(
		transcriptionProviderId,
	);
	const transcriptionModelValue =
		values["transcription.model"] ?? transcriptionProviderInfo?.models[0] ?? "";
	const transcriptionModelOptions = [
		...(transcriptionProviderInfo?.models ?? []),
		...(transcriptionModelValue &&
		!transcriptionProviderInfo?.models.includes(transcriptionModelValue)
			? [transcriptionModelValue]
			: []),
	];
	const transcriptionSection: SettingsItem = {
		label: "Transcription",
		kind: "section",
		key: "transcription",
		children: [
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
			...(transcriptionProviderInfo?.reusesOpenAiToken
				? [
						{
							label:
								"OpenAI reuses your AI → OpenAI API token when no key is set here.",
							kind: "hint" as const,
							key: "transcription._openaiHint",
						},
					]
				: []),
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

	const listenSection: SettingsItem = {
		label: "Listen",
		kind: "section",
		key: "listen",
		children: [
			{
				label: "Start new recording",
				kind: "action",
				key: "listen._start",
			},
			...(recordingSections.length > 0
				? recordingSections
				: [
						{
							label: "No recordings yet.",
							kind: "hint" as const,
							key: "listen._empty",
						},
					]),
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
	const daemonRunning = ctx.daemonRunning;
	const activeScheduleCount = schedules.filter((s) => s.enabled).length;
	const scheduleSections: SettingsItem[] = schedules.map((schedule) => {
		let runs: ReturnType<typeof listScheduleRuns> = [];
		try {
			runs = listScheduleRuns(schedule.id, 3);
		} catch {
			runs = [];
		}
		const runItems: SettingsItem[] = runs.map((run) => ({
			label: `${new Date(run.startedAt).toLocaleString()} · ${run.status.toUpperCase()}`,
			kind: "action" as const,
			key: `schedules.${schedule.id}.runs.${run.id}`,
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

	function buildProjectsSection(values: Record<string, string>): SettingsItem {
		const projects = listProjects();
		const activeSlug = getActiveProjectSlug();
		const allSkillNames = loadLocalSkills().map((s) => s.name);
		const allIntegrationNames = getIntegrationModules().map((m) => m.name);
		const projectSections: SettingsItem[] = projects.map((project) => {
			const isActive = project.slug === activeSlug;
			const skillValue =
				values[`projects.${project.slug}.skills`] ?? project.skills.join(", ");
			const integrationsValue =
				values[`projects.${project.slug}.integrations`] ??
				project.integrations.join(", ");
			return {
				label: `${isActive ? "★ " : ""}${project.name}`,
				kind: "section" as const,
				key: `projects.${project.slug}`,
				children: [
					{
						label: "Name",
						kind: "value" as const,
						key: `projects.${project.slug}.name`,
						currentValue: project.name,
					},
					{
						label: "Context path",
						kind: "hint" as const,
						key: `projects.${project.slug}._contextDir`,
						currentValue: project.contextDir,
					},
					{
						label: "Pinned skills",
						kind: "multiSelect" as const,
						key: `projects.${project.slug}.skills`,
						currentValue: skillValue,
						options: allSkillNames,
						selectedValues: skillValue
							? skillValue
									.split(",")
									.map((s) => s.trim())
									.filter(Boolean)
							: [],
					},
					{
						label: "Context integrations",
						kind: "multiSelect" as const,
						key: `projects.${project.slug}.integrations`,
						currentValue: integrationsValue,
						options: allIntegrationNames,
						selectedValues: integrationsValue
							? integrationsValue
									.split(",")
									.map((s) => s.trim())
									.filter(Boolean)
							: [],
					},
					{
						label: "Delete project",
						kind: "delete" as const,
						key: `projects.${project.slug}._delete`,
					},
				],
			};
		});

		return {
			label: "Projects",
			kind: "section",
			key: "projects",
			children: [
				{
					label: "Add Project",
					kind: "action",
					key: "projects._new",
				},
				...(projectSections.length > 0
					? projectSections
					: [
							{
								label: "No projects yet. Use /project to create one.",
								kind: "hint" as const,
								key: "projects._empty",
							},
						]),
			],
		};
	}

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
				children: [
					{
						label: "OpenAI",
						kind: "section",
						key: "ai.openai",
						iconUrl: "/icons/ai/openai.png",
						description:
							"Use OpenAI models like GPT-5, GPT-4o, and o3 directly with your OpenAI API token.",
						docUrl: "https://openai.com/api/",
						children: [
							{
								label: "API Token",
								kind: "value",
								key: "ai.openai.token",
								masked: true,
							},
						],
					},
					{
						label: "Vercel AI Gateway",
						kind: "section",
						key: "ai.vercel",
						iconUrl: "/icons/ai/vercel.png",
						description:
							"Access models from OpenAI, Anthropic, Google, xAI, and more through a single Vercel AI Gateway API key.",
						docUrl: "https://vercel.com/ai-gateway",
						children: [
							{
								label: "API Key",
								kind: "value",
								key: "ai.vercel.apiKey",
								masked: true,
							},
						],
					},
					{
						label: "Ollama",
						kind: "section",
						key: "ai.ollama",
						iconUrl: "/icons/ai/ollama.png",
						description:
							"Run open-source models like Llama, Qwen, and Mistral locally on your machine with Ollama.",
						docUrl: "https://docs.ollama.com/quickstart",
						children: [
							{
								label: "Base URL",
								kind: "value",
								key: "ai.ollama.baseUrl",
								currentValue:
									values["ai.ollama.baseUrl"] ?? "http://localhost:11434/v1",
							},
							{
								label: "API Key (optional)",
								kind: "value",
								key: "ai.ollama.apiKey",
								masked: true,
							},
						],
					},
				],
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
			buildProjectsSection(values),
			listenSection,
			schedulesSection,
		],
	};
}
