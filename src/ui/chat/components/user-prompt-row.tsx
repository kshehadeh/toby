import { Box, Text } from "ink";
import React from "react";
import { ACCENT } from "../constants";

export function UserPromptRow({
	text,
	width,
}: { readonly text: string; readonly width: number }) {
	const inner = Math.max(1, width - 1);
	const padded = `${text}${" ".repeat(Math.max(0, inner - text.length))}`.slice(
		0,
		inner,
	);
	return (
		<Box flexDirection="row" width={width}>
			<Text color={ACCENT}>█</Text>
			<Text backgroundColor="gray" color="white" wrap="truncate-end">
				{padded}
			</Text>
		</Box>
	);
}
