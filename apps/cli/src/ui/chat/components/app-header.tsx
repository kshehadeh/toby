import { getTobyVersion } from "@toby/core/version";
import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { ACCENT, CHAT_TITLE_ASCII } from "../constants";

const TOBY_VERSION = getTobyVersion();

interface AppHeaderProps {
	readonly termCols?: number;
	readonly subheader?: ReactNode;
}

export function AppHeader({ termCols, subheader }: AppHeaderProps) {
	return (
		<>
			<Box flexShrink={0} width={termCols} flexDirection="column">
				{CHAT_TITLE_ASCII.map((line) => (
					<Box key={line} width={termCols} justifyContent="center">
						<Text color={ACCENT} bold wrap="truncate-end">
							{line}
						</Text>
					</Box>
				))}
				<Box width={termCols} justifyContent="center">
					<Text dimColor wrap="truncate-end">
						v{TOBY_VERSION}
					</Text>
				</Box>
			</Box>
			{subheader ? (
				<Box
					marginTop={0}
					flexShrink={0}
					width={termCols}
					justifyContent="center"
				>
					{subheader}
				</Box>
			) : null}
		</>
	);
}
