import { Box, Text } from "ink";
import React from "react";
import { SelectableTextRow, ViewModal } from "../../shared";
import { ACCENT } from "../constants";
import type { AskModal } from "../types";

export function AskUserModal({
	modal,
	selectedIndex,
	termCols,
}: {
	readonly modal: AskModal;
	readonly selectedIndex: number;
	readonly termCols: number;
}) {
	// Account for border + horizontal padding so wrapped lines stay inside.
	const contentWidth = Math.max(12, termCols - 4);

	return (
		<ViewModal termCols={termCols} borderColor={ACCENT}>
			<Box width={contentWidth}>
				<Text bold wrap="wrap">
					{modal.query}
				</Text>
			</Box>
			{modal.options.map((opt, i) => (
				<SelectableTextRow key={opt} selected={i === selectedIndex}>
					{i + 1}. {opt}
				</SelectableTextRow>
			))}
			<Box marginTop={1} width={contentWidth}>
				<Text dimColor wrap="truncate-end">
					↑↓ Enter to choose · Esc to cancel
				</Text>
			</Box>
		</ViewModal>
	);
}
