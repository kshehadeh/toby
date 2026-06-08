import type { AIProviderInfo } from "../ai/providers";
import { getDefaultPersonaName, getSkillsDir } from "../config/index";
import {
	getIntegrationModules,
	getModulesForCategory,
	getModulesWithCapability,
} from "../integrations/index";
import {
	ALL_PROVIDER_CATEGORIES,
	PROVIDER_CATEGORY_LABELS,
	type ProviderCategory,
} from "../integrations/types";
import { DEFAULT_CHAT_PERSONA } from "../personas/index";
import { cronToHuman } from "../schedules/cron-human";
import { listScheduleRuns, listSchedules } from "../schedules/store";
import { loadLocalSkills } from "../skills/index";
import {
	formatListenDuration,
	formatListenRecordingDate,
	listenRecordingTreeLabel,
} from "./format";
import type { ConfigureTreeContext, SettingsItem } from "./types";
import { DEFAULT_CONFIGURE_TREE_CONTEXT } from "./types";

export type { ConfigureTreeContext, SettingsItem } from "./types";
export { CONFIGURE_TREE_ACTION_KEYS } from "./types";

const MAX_SKILL_BODY_PREVIEW = 200;
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
				options: providerInfo?.models ?? [],
				currentValue: modelValue,
			},
		];
		if (providerInfo?.allowCustomModel) {
			aiModelItems.push({
				label: "Custom model slug",
				kind: "value" as const,
				key: `personas.${p.name}.ai.model`,
				navKey: `personas.${p.name}.ai.model.custom`,
				currentValue: modelValue,
			});
		}

		const readOnlyAiItems: SettingsItem[] = [
			{
				label: "AI Provider",
				kind: "hint" as const,
				key: `personas.${p.name}.ai.provider`,
				currentValue:
					providerInfo?.displayName ??
					availableProviders.find((pr) => pr.id === providerId)?.displayName ??
					providerId,
			},
			{
				label: "AI Model",
				kind: "hint" as const,
				key: `personas.${p.name}.ai.model`,
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
				...(isBuiltIn ? readOnlyAiItems : aiModelItems),
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

	const skillSections: SettingsItem[] = loadLocalSkills().map((skill) => ({
		label: skill.name,
		kind: "section" as const,
		key: `skills.${skill.dirName}`,
		children: [
			{
				label: "Name",
				kind: "value" as const,
				key: `skills.${skill.dirName}.name`,
				currentValue: skill.name,
			},
			{
				label: "Description",
				kind: "value" as const,
				key: `skills.${skill.dirName}.description`,
				currentValue: skill.description,
				multiline: true,
			},
			{
				label: "Summary",
				kind: "value" as const,
				key: `skills.${skill.dirName}.summary`,
				currentValue: skill.summary,
				multiline: true,
			},
			{
				label: "Path",
				kind: "hint" as const,
				key: `skills.${skill.dirName}._file`,
				currentValue: `${getSkillsDir()}/${skill.dirName}/SKILL.md`,
			},
			...(skill.bodyMarkdown.trim()
				? [
						{
							label: "Excerpt",
							kind: "hint" as const,
							key: `skills.${skill.dirName}._preview`,
							currentValue: truncateSkillPreview(
								skill.bodyMarkdown,
								MAX_SKILL_BODY_PREVIEW,
							),
							multiline: true,
						},
					]
				: []),
			{
				label: "Edit in editor",
				kind: "action" as const,
				key: `skills.${skill.dirName}._edit`,
			},
			{
				label: "Delete skill",
				kind: "delete" as const,
				key: `skills.${skill.dirName}._delete`,
			},
		],
	}));

	const skillsSection: SettingsItem = {
		label: "Skills",
		kind: "section",
		key: "skills",
		children:
			skillSections.length > 0
				? skillSections
				: [
						{
							label: `No skills found. Add skills to ${getSkillsDir()}`,
							kind: "hint",
							key: "skills._empty",
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

	const transcriptionPlugins = getModulesWithCapability("transcription");
	const transcriptionPluginChoices = [
		{ value: "(none)", label: "None" },
		...transcriptionPlugins.map((mod) => ({
			value: mod.name,
			label: mod.displayName,
		})),
	];
	const listenSection: SettingsItem = {
		label: "Listen",
		kind: "section",
		key: "listen",
		children: [
			{
				label: "Transcription provider",
				kind: "select",
				key: "listen.transcriptionPlugin",
				options: ["(none)", ...transcriptionPlugins.map((mod) => mod.name)],
				selectChoices: transcriptionPluginChoices,
				currentValue: values["listen.transcriptionPlugin"] ?? "(none)",
			},
			...(values["listen.transcriptionPlugin"] === "whisper"
				? [
						{
							label:
								"Configure whisper paths under Plugins → whisper in the category tree.",
							kind: "hint" as const,
							key: "listen._whisperHint",
						},
					]
				: []),
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
				children: [
					{
						label: "OpenAI",
						kind: "section",
						key: "ai.openai",
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
						children: [
							{
								label: "API Key",
								kind: "value",
								key: "ai.vercel.apiKey",
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
			skillsSection,
			listenSection,
			schedulesSection,
		],
	};
}
