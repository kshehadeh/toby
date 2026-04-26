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
	return (
		<Box
			marginTop={1}
			flexShrink={0}
			flexDirection="column"
			borderStyle="round"
			borderColor="cyan"
			paddingX={1}
		>
			<Box width={termCols}>
				<Text bold wrap="truncate-end">
					{modal.query}
				</Text>
			</Box>
			{modal.options.map((opt, i) => (
				<Box key={opt} width={termCols}>
					<Text
						color={i === selectedIndex ? "cyan" : undefined}
						wrap="truncate-end"
					>
						{i === selectedIndex ? "› " : "  "}
						{i + 1}. {opt}
					</Text>
				</Box>
			))}
			<Box marginTop={1}>
				<Text dimColor>↑↓ Enter to choose · Esc to cancel</Text>
			</Box>
		</Box>
	);
}
