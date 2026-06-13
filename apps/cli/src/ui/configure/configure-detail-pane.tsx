import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { UI_GLYPHS } from "../shared/glyphs";
import {
	DetailActionRow,
	DetailActionsHeader,
	type DetailPaneField,
	InlineFieldRow,
	ReadOnlyLine,
	truncateDetailPreview,
} from "./detail-pane-rows";

export interface ConfigureDetailPaneProps {
	readonly fields: readonly DetailPaneField[];
	readonly selectedKey: string | null;
	readonly paneActive: boolean;
}

export function detailPaneFieldKey(field: DetailPaneField): string {
	return field.item.navKey ?? field.item.key;
}

function displayFieldValue(field: DetailPaneField, selected: boolean): string {
	const raw = field.currentValue ?? field.item.currentValue ?? "";
	if ((field.masked ?? field.item.masked) && raw && !selected) {
		return "••••••";
	}
	return raw;
}

function renderActionField(
	field: DetailPaneField,
	selected: boolean,
): ReactNode {
	if (field.kind === "delete") {
		return (
			<DetailActionRow
				key={detailPaneFieldKey(field)}
				icon={UI_GLYPHS.checkboxOn}
				label={field.item.label}
				selected={selected}
				deleteAction
			/>
		);
	}

	const label = field.item.label.replace(/^★\s*/, "");
	return (
		<DetailActionRow
			key={detailPaneFieldKey(field)}
			icon={
				field.item.label.startsWith("★")
					? UI_GLYPHS.defaultPersona
					: UI_GLYPHS.action
			}
			label={label}
			selected={selected}
		/>
	);
}

function renderHintField(field: DetailPaneField): ReactNode {
	const value = field.currentValue ?? field.item.currentValue;
	if (value) {
		const display =
			field.multiline || field.item.multiline
				? truncateDetailPreview(value)
				: value;
		return (
			<ReadOnlyLine
				key={detailPaneFieldKey(field)}
				label={field.item.label}
				value={display}
			/>
		);
	}

	return (
		<Box key={detailPaneFieldKey(field)} paddingX={1}>
			<Text dimColor wrap="wrap">
				{field.item.label}
			</Text>
		</Box>
	);
}

function renderFormField(field: DetailPaneField, selected: boolean): ReactNode {
	const label = field.item.label;
	const value = displayFieldValue(field, selected);

	if (
		field.kind === "value" ||
		field.kind === "select" ||
		field.kind === "multiSelect"
	) {
		return (
			<InlineFieldRow
				key={detailPaneFieldKey(field)}
				label={label}
				value={value}
				selected={selected}
				multiline={field.multiline ?? field.item.multiline}
			/>
		);
	}

	if (field.kind === "section") {
		return (
			<DetailActionRow
				key={detailPaneFieldKey(field)}
				icon={UI_GLYPHS.section}
				label={label}
				selected={selected}
			/>
		);
	}

	return null;
}

export function ConfigureDetailPane({
	fields,
	selectedKey,
	paneActive,
}: ConfigureDetailPaneProps) {
	const isSelected = (field: DetailPaneField) =>
		Boolean(paneActive && selectedKey === detailPaneFieldKey(field));

	const nodes: ReactNode[] = [];
	let actionsHeaderShown = false;

	for (const field of fields) {
		if (field.kind === "action" || field.kind === "delete") {
			if (!actionsHeaderShown) {
				nodes.push(<DetailActionsHeader key="actions-header" />);
				actionsHeaderShown = true;
			}
			nodes.push(renderActionField(field, isSelected(field)));
			continue;
		}

		if (field.kind === "hint") {
			nodes.push(renderHintField(field));
			continue;
		}

		nodes.push(renderFormField(field, isSelected(field)));
	}

	return <>{nodes}</>;
}
