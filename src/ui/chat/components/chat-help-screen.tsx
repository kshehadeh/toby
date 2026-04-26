import { Box, Text } from "ink";
import React from "react";
import type { SlashCommand } from "../slash-commands";

export function ChatHelpScreen({
	termCols,
	commands,
}: {
	readonly termCols: number;
	readonly commands: readonly SlashCommand[];
}) {
	return (
		<Box flexDirection="column" padding={1} width={termCols}>
			<Text bold>Slash commands</Text>
			<Box marginTop={1} flexDirection="column">
				{commands.map((command, index) => (
					<Box
						key={command.command}
						marginTop={index === 0 ? 0 : 1}
						flexDirection="row"
						flexWrap="wrap"
					>
						<Text bold>{command.command} </Text>
						<Text dimColor>{command.helpText}</Text>
					</Box>
				))}
			</Box>
			<Box marginTop={1} flexDirection="column">
				<Text dimColor>
					Long replies use the full terminal height; scroll the terminal
					scrollback to see earlier lines.
				</Text>
				<Text dimColor>
					Type `/` in the prompt to open command autocomplete; use Tab or
					Up/Down to cycle.
				</Text>
				<Text dimColor>Esc or Enter to return</Text>
			</Box>
		</Box>
	);
}
