import { Box, Text } from "ink";
import React from "react";
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
		<Box
			marginTop={1}
			flexShrink={0}
			flexDirection="column"
			borderStyle="round"
			borderColor="cyan"
			paddingX={1}
		>
			<Box width={contentWidth}>
				<Text bold wrap="wrap">
					{modal.query}
				</Text>
			</Box>
			{modal.options.map((opt, i) => (
				<Box key={opt} width={contentWidth}>
					<Text color={i === selectedIndex ? "cyan" : undefined} wrap="wrap">
						{i === selectedIndex ? "› " : "  "}
						{i + 1}. {opt}
					</Text>
				</Box>
			))}
			<Box marginTop={1} width={contentWidth}>
				<Text dimColor wrap="truncate-end">
					↑↓ Enter to choose · Esc to cancel
				</Text>
			</Box>
		</Box>
	);
}
