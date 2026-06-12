import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { formatSelectChoiceLabel } from "@/lib/select-choice-label";
import type { SettingsItem } from "@/types";
import { useState } from "react";

import { Input } from "@/components/ui/input";

const ADD_CUSTOM_MODEL_SENTINEL = "__add_custom_model__";

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
	const [customInputVisible, setCustomInputVisible] = useState(false);
	const [customInputValue, setCustomInputValue] = useState("");
	const options = (field.options ?? []).filter(
		(opt) => opt !== ADD_CUSTOM_MODEL_SENTINEL,
	);
	const hasAddCustom = (field.options ?? []).includes(
		ADD_CUSTOM_MODEL_SENTINEL,
	);
	const selectedValue = resolveSelectValue(value, options);
	const labelOptions = { integrationLabels };

	if (customInputVisible) {
		return (
			<div className="flex items-center gap-2">
				<Input
					className="w-44"
					placeholder="Enter custom model name"
					value={customInputValue}
					onChange={(e) => setCustomInputValue(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && customInputValue.trim()) {
							onChange(customInputValue.trim());
							setCustomInputVisible(false);
							setCustomInputValue("");
						}
						if (e.key === "Escape") {
							setCustomInputVisible(false);
							setCustomInputValue("");
						}
					}}
					disabled={disabled}
					autoFocus
				/>
				<button
					type="button"
					className="text-muted-foreground text-sm hover:underline"
					onClick={() => {
						setCustomInputVisible(false);
						setCustomInputValue("");
					}}
				>
					Cancel
				</button>
			</div>
		);
	}

	return (
		<div className="flex items-center gap-2">
			<Select
				value={selectedValue}
				onValueChange={(v) => {
					if (v === ADD_CUSTOM_MODEL_SENTINEL) {
						setCustomInputVisible(true);
						return;
					}
					onChange(v);
				}}
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
					{hasAddCustom && (
						<SelectItem value={ADD_CUSTOM_MODEL_SENTINEL}>
							+ Add custom model…
						</SelectItem>
					)}
				</SelectContent>
			</Select>
		</div>
	);
}
