import { Box, Text } from "ink";
import type React from "react";
import { AppHeader } from "../chat/components/app-header";
import { ACCENT, INPUT_BORDER } from "../chat/constants";

export interface ViewFrameProps {
	readonly title: string;
	readonly children: React.ReactNode;
	readonly footer?: React.ReactNode;
}

export function ViewFrame({ title, children, footer }: ViewFrameProps) {
	return (
		<Box flexDirection="column" padding={1}>
			<AppHeader
				subheader={
					<Text color={ACCENT} bold wrap="truncate-end">
						{title}
					</Text>
				}
			/>
			<Box
				marginTop={1}
				borderStyle="single"
				borderColor={INPUT_BORDER}
				flexDirection="column"
			>
				{children}
			</Box>
			{footer ? (
				<Box marginTop={1} paddingX={1}>
					{footer}
				</Box>
			) : null}
		</Box>
	);
}
