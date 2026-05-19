import type { AIProviderInfo } from "../../ai/providers";
import { getDefaultPersonaName } from "../../config/index";
import {
	getIntegrationModules,
	getModulesForCategory,
} from "../../integrations/index";
import {
	ALL_PROVIDER_CATEGORIES,
	PROVIDER_CATEGORY_LABELS,
	type ProviderCategory,
} from "../../integrations/types";

type ItemKind = "section" | "value" | "action" | "select" | "delete";

export type SettingsSelectChoice = {
	readonly value: string;
	readonly label: string;
};

export interface SettingsItem {
	label: string;
	kind: ItemKind;
	/** Storage key in configure values (and config on save). */
	key: string;
	/** Unique navigation row id; defaults to `key`. */
	navKey?: string;
	children?: SettingsItem[];
	masked?: boolean;
	multiline?: boolean;
	/** Plain option values (label matches value). */
	options?: string[];
	/** Labeled options for select fields (value stored, label shown). */
	selectChoices?: SettingsSelectChoice[];
	currentValue?: string;
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
): SettingsItem {
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
				Boolean(mod.chatInbound) &&
				(inboundActive || integrationInboundOn);

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

			return {
				label: mod.displayName,
				kind: "section" as const,
				key: mod.name,
				children: [...authSelect, ...credentialItems, ...inboundItems],
			};
		},
	);

	const currentDefault = getDefaultPersonaName();

	const personaItems: SettingsItem[] = personas.map((p) => {
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

		return {
			label: p.name,
			kind: "section" as const,
			key: `personas.${p.name}`,
			children: [
				{
					label: "Name",
					kind: "value" as const,
					key: `personas.${p.name}.name`,
					currentValue: p.name,
				},
				{
					label: "Instructions",
					kind: "value" as const,
					key: `personas.${p.name}.instructions`,
					currentValue: p.instructions,
					multiline: true,
				},
				{
					label: "Prompt Mode",
					kind: "select" as const,
					key: `personas.${p.name}.promptMode`,
					options: ["add", "replace"],
					currentValue: p.promptMode,
				},
				...aiModelItems,
				{
					label:
						currentDefault === p.name ? "★ Default persona" : "Set as default",
					kind: "action" as const,
					key: `personas.${p.name}._setDefault`,
				},
				{
					label: "Delete this persona",
					kind: "delete" as const,
					key: `personas.${p.name}._delete`,
				},
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
		label: "Daemon / inbound chat",
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
						label: "New Persona",
						kind: "action",
						key: "personas._new",
					},
					...personaItems,
				],
			},
		],
	};
}
