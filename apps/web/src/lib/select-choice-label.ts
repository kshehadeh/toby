import type { SettingsItem } from "@/types";

interface FormatSelectChoiceLabelOptions {
	readonly integrationLabels?: Record<string, string>;
}

export function formatSelectChoiceLabel(
	field: SettingsItem,
	value: string,
	options: FormatSelectChoiceLabelOptions = {},
): string {
	const fromChoices = field.selectChoices?.find(
		(choice) => choice.value === value,
	)?.label;
	if (fromChoices) return fromChoices;
	if (value === "(none)") return "None";
	return options.integrationLabels?.[value] ?? value;
}
