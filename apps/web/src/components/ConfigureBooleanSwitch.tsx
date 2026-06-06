import { ConfigureSettingRow } from "@/components/ConfigureSettingRow";
import { Switch } from "@/components/ui/switch";
import {
	booleanSelectValue,
	isBooleanSelectChecked,
} from "@/lib/boolean-select-field";
import type { SettingsItem } from "@/types";

interface ConfigureBooleanSwitchProps {
	field: SettingsItem;
	value: string;
	onChange: (value: string) => void;
	disabled?: boolean;
}

export function ConfigureBooleanSwitch({
	field,
	value,
	onChange,
	disabled = false,
}: ConfigureBooleanSwitchProps) {
	const inputId = `configure-${field.key.replace(/[^a-zA-Z0-9._-]/g, "-")}`;
	const checked = isBooleanSelectChecked(field, value);

	return (
		<ConfigureSettingRow label={field.label} htmlFor={inputId}>
			<Switch
				id={inputId}
				checked={checked}
				onCheckedChange={(next) => onChange(booleanSelectValue(field, next))}
				disabled={disabled}
				aria-label={field.label}
			/>
		</ConfigureSettingRow>
	);
}
