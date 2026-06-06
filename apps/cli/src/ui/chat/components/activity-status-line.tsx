import { Box, Text } from "ink";
import React from "react";
import { dotGridSpinnerFrame } from "../../shared/dot-grid-spinner";
import { ACCENT } from "../constants";

export type ActivityStatusLineProps = {
	readonly text: string;
	readonly animating: boolean;
	readonly termCols: number;
	readonly frame: number;
};

export function ActivityStatusLine({
	text,
	animating,
	termCols,
	frame,
}: ActivityStatusLineProps) {
	const display = text.length > 0 ? text : " ";
	return (
		<Box marginTop={1} width={termCols} flexShrink={0}>
			<Text dimColor wrap="truncate-end">
				{animating ? (
					<>
						<Text color={ACCENT}>{dotGridSpinnerFrame(frame)} </Text>
						{display}
					</>
				) : (
					display
				)}
			</Text>
		</Box>
	);
}
