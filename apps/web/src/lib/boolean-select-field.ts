import type { SettingsItem } from "@/types";

const TRUE_FALSE_OPTIONS = ["false", "true"] as const;
const YES_NO_OPTIONS = ["No", "Yes"] as const;

function optionsMatch(options: string[], expected: readonly string[]): boolean {
	return (
		options.length === expected.length &&
		expected.every((value) => options.includes(value))
	);
}

export function isBooleanSelectField(field: SettingsItem): boolean {
	if (field.kind !== "select" || !field.options?.length) return false;
	const options = field.options;
	return (
		optionsMatch(options, TRUE_FALSE_OPTIONS) ||
		optionsMatch(options, YES_NO_OPTIONS)
	);
}

export function isBooleanSelectChecked(
	field: SettingsItem,
	value: string,
): boolean {
	if (optionsMatch(field.options ?? [], TRUE_FALSE_OPTIONS)) {
		return value === "true";
	}
	if (optionsMatch(field.options ?? [], YES_NO_OPTIONS)) {
		return value === "Yes";
	}
	return false;
}

export function booleanSelectValue(
	field: SettingsItem,
	checked: boolean,
): string {
	if (optionsMatch(field.options ?? [], TRUE_FALSE_OPTIONS)) {
		return checked ? "true" : "false";
	}
	if (optionsMatch(field.options ?? [], YES_NO_OPTIONS)) {
		return checked ? "Yes" : "No";
	}
	return checked ? "true" : "false";
}
