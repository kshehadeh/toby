import { Box, Text } from "ink";
import React from "react";
import { ACCENT } from "../constants";

export function UserPromptRow({
	text,
	width,
}: { readonly text: string; readonly width: number }) {
	// Reserve two columns for the visual prefix: "█ ".
	const inner = Math.max(1, width - 2);
	const padded = `${text}${" ".repeat(Math.max(0, inner - text.length))}`.slice(
		0,
		inner,
	);
	return (
		<Box flexDirection="row" width={width}>
			<Text color={ACCENT}>█</Text>
			<Text> </Text>
			<Text wrap="truncate-end">{padded}</Text>
		</Box>
	);
}
