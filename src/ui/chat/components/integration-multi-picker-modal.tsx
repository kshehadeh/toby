import { Box, Text } from "ink";
import React from "react";
import type { IntegrationModule } from "../../../integrations/types";
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
		<Box
			marginTop={1}
			flexShrink={0}
			flexDirection="column"
			borderStyle="round"
			borderColor={ACCENT}
			paddingX={1}
		>
			<Box width={termCols}>
				<Text bold wrap="truncate-end">
					Choose integrations (Space toggles · Enter applies · Esc cancels)
				</Text>
			</Box>
			{rows.map((row, i) => {
				const active = i === cursorIndex;
				const prefix = active ? "› " : "  ";
				if (row.kind === "all") {
					return (
						<Box key="all" width={termCols}>
							<Text color={active ? ACCENT : undefined} wrap="truncate-end">
								{prefix}
								[All connected below] Select / clear all
							</Text>
						</Box>
					);
				}
				const checked = selectedNames.has(row.module.name);
				return (
					<Box key={row.module.name} width={termCols}>
						<Text color={active ? ACCENT : undefined} wrap="truncate-end">
							{prefix}
							{checked ? "[x] " : "[ ] "}
							{row.module.displayName}
						</Text>
					</Box>
				);
			})}
			<Box marginTop={1}>
				<Text dimColor>
					Selected: {selectedNames.size} · minimum 1 to apply
				</Text>
			</Box>
		</Box>
	);
}
