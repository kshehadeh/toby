import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { formatSelectChoiceLabel } from "@/lib/select-choice-label";
import type { SettingsItem } from "@/types";

interface ConfigureSelectProps {
	field: SettingsItem;
	value: string;
	onChange: (value: string) => void;
	disabled?: boolean;
	triggerClassName?: string;
	integrationLabels?: Record<string, string>;
}

function resolveSelectValue(value: string, options: string[]): string {
	if (options.includes(value)) return value;
	return options[0] ?? "";
}

export function ConfigureSelect({
	field,
	value,
	onChange,
	disabled = false,
	triggerClassName,
	integrationLabels,
}: ConfigureSelectProps) {
	const options = field.options ?? [];
	const selectedValue = resolveSelectValue(value, options);
	const labelOptions = { integrationLabels };

	return (
		<Select
			value={selectedValue}
			onValueChange={onChange}
			disabled={disabled || options.length === 0}
		>
			<SelectTrigger className={triggerClassName}>
				<SelectValue placeholder="Select provider">
					{formatSelectChoiceLabel(field, selectedValue, labelOptions)}
				</SelectValue>
			</SelectTrigger>
			<SelectContent position="popper" align="start" sideOffset={4}>
				{options.map((opt) => (
					<SelectItem key={opt} value={opt}>
						{formatSelectChoiceLabel(field, opt, labelOptions)}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
