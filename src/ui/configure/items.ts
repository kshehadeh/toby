import { getIntegrationModules } from "../../integrations/index";

type ItemKind = "section" | "value" | "action" | "select" | "delete";

export interface SettingsItem {
	label: string;
	kind: ItemKind;
	key: string;
	children?: SettingsItem[];
	masked?: boolean;
	multiline?: boolean;
	options?: string[];
	currentValue?: string;
}

export function buildSettingsTree(
	personas: {
		name: string;
		ai: { provider: string; model: string };
		instructions: string;
		promptMode: "add" | "replace";
	}[],
	availableProviders: { id: string; displayName: string; models: string[] }[],
): SettingsItem {
	const integrationSections: SettingsItem[] = getIntegrationModules().map(
		(mod) => ({
			label: mod.displayName,
			kind: "section" as const,
			key: mod.name,
			children: mod.getCredentialDescriptors().map((d) => ({
				label: d.label,
				kind: "value" as const,
				key: d.key,
				masked: d.masked,
				multiline: d.multiline,
			})),
		}),
	);

	const personaItems: SettingsItem[] = personas.map((p) => ({
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
			{
				label: "AI Provider",
				kind: "select" as const,
				key: `personas.${p.name}.ai.provider`,
				options: availableProviders.map((pr) => pr.id),
				currentValue: p.ai.provider,
			},
			{
				label: "AI Model",
				kind: "select" as const,
				key: `personas.${p.name}.ai.model`,
				options:
					availableProviders.find((pr) => pr.id === p.ai.provider)?.models ??
					[],
				currentValue: p.ai.model,
			},
			{
				label: "Delete this persona",
				kind: "delete" as const,
				key: `personas.${p.name}._delete`,
			},
		],
	}));

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
