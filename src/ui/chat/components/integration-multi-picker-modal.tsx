import { Box, Text } from "ink";
import React from "react";
import type { IntegrationModule } from "../../../integrations/types";
import { SelectableTextRow, UI_GLYPHS, ViewModal } from "../../shared";
import { ACCENT } from "../constants";

type IntegrationMultiPickerRow =
	| { readonly kind: "all" }
	| { readonly kind: "module"; readonly module: IntegrationModule };

export function buildIntegrationPickerRows(
	modules: readonly IntegrationModule[],
): IntegrationMultiPickerRow[] {
	return [
		{ kind: "all" },
		...modules.map((m) => ({ kind: "module" as const, module: m })),
	];
}

export function IntegrationMultiPickerModal({
	rows,
	cursorIndex,
	selectedNames,
	termCols,
}: {
	readonly rows: readonly IntegrationMultiPickerRow[];
	readonly cursorIndex: number;
	readonly selectedNames: ReadonlySet<string>;
	readonly termCols: number;
}) {
	return (
		<ViewModal termCols={termCols} borderColor={ACCENT}>
			<Box width={termCols}>
				<Text bold wrap="truncate-end">
					Choose integrations (Space toggles · Enter applies · Esc cancels)
				</Text>
			</Box>
			{rows.map((row, i) => {
				const active = i === cursorIndex;
				if (row.kind === "all") {
					return (
						<SelectableTextRow key="all" selected={active}>
							[All connected below] Select / clear all
						</SelectableTextRow>
					);
				}
				const checked = selectedNames.has(row.module.name);
				return (
					<SelectableTextRow key={row.module.name} selected={active}>
						{checked ? UI_GLYPHS.checkboxOn : UI_GLYPHS.checkboxOff}{" "}
						{row.module.displayName}
					</SelectableTextRow>
				);
			})}
			<Box marginTop={1}>
				<Text dimColor>
					Selected: {selectedNames.size} · minimum 1 to apply
				</Text>
			</Box>
		</ViewModal>
	);
}
