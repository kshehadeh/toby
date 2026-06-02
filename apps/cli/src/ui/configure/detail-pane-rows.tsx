import { Box, Text } from "ink";
import { ACCENT } from "../chat/constants";
import type { SettingsItem } from "./items";

export interface DetailPaneField {
	readonly item: SettingsItem;
	readonly kind: SettingsItem["kind"];
	readonly currentValue?: string;
	readonly multiline?: boolean;
	readonly masked?: boolean;
}

const DEFAULT_DETAIL_PREVIEW_MAX = 120;

export function truncateDetailPreview(
	text: string,
	max = DEFAULT_DETAIL_PREVIEW_MAX,
): string {
	const trimmed = text.trim();
	if (trimmed.length <= max) {
		return trimmed;
	}
	return `${trimmed.slice(0, max - 1)}…`;
}

export function formatInlineValue(value: string, multiline?: boolean): string {
	if (!multiline) {
		return value;
	}
	return truncateDetailPreview(value);
}

export function InlineFieldRow({
	label,
	value,
	selected,
	multiline,
}: {
	readonly label: string;
	readonly value: string;
	readonly selected: boolean;
	readonly multiline?: boolean;
}) {
	const display = formatInlineValue(value, multiline);

	return (
		<Box
			width="100%"
			paddingX={1}
			backgroundColor={selected ? ACCENT : undefined}
		>
			<Text wrap="truncate-end">
				<Text bold color={selected ? "white" : undefined}>
					{label}:{" "}
				</Text>
				<Text color={selected ? "white" : undefined} dimColor={!selected}>
					{display}
				</Text>
			</Text>
		</Box>
	);
}

export function MultilineFieldBlock({
	label,
	value,
	selected,
}: {
	readonly label: string;
	readonly value: string;
	readonly selected: boolean;
}) {
	return (
		<Box
			width="100%"
			paddingX={1}
			backgroundColor={selected ? ACCENT : undefined}
			flexDirection="column"
		>
			<Text bold color={selected ? "white" : undefined}>
				{label}:
			</Text>
			<Text
				color={selected ? "white" : undefined}
				dimColor={!selected}
				wrap="wrap"
			>
				{value || " "}
			</Text>
		</Box>
	);
}

export function ReadOnlyBlock({
	label,
	value,
}: {
	readonly label: string;
	readonly value: string;
}) {
	return (
		<Box paddingX={1} flexDirection="column">
			<Text>{label}:</Text>
			<Text dimColor wrap="wrap">
				{value}
			</Text>
		</Box>
	);
}

export function ReadOnlyLine({
	label,
	value,
}: {
	readonly label: string;
	readonly value: string;
}) {
	return (
		<Box paddingX={1}>
			<Text wrap="truncate-end">
				<Text>{label}: </Text>
				<Text dimColor>{value}</Text>
			</Text>
		</Box>
	);
}

export function DetailActionsHeader() {
	return (
		<Box paddingX={1} marginTop={1}>
			<Text bold>Actions</Text>
		</Box>
	);
}

export function DetailActionRow({
	icon,
	label,
	selected,
	deleteAction = false,
}: {
	readonly icon: string;
	readonly label: string;
	readonly selected: boolean;
	readonly deleteAction?: boolean;
}) {
	return (
		<Box
			width="100%"
			paddingX={1}
			backgroundColor={selected ? ACCENT : undefined}
		>
			<Text
				color={selected ? "white" : deleteAction ? "red" : undefined}
				wrap="truncate-end"
			>
				{icon} {label}
			</Text>
		</Box>
	);
}

export function findDetailField(
	fields: readonly DetailPaneField[],
	suffix: string,
): DetailPaneField | undefined {
	return fields.find((field) => field.item.key.endsWith(suffix));
}
