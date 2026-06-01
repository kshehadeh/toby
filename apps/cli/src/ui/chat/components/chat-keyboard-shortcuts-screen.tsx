import { Box, Text } from "ink";
import React, { useMemo } from "react";
import { detectTerminalProfile } from "../../shared/terminal-profile";
import { buildChatKeyboardShortcuts } from "../chat-keyboard-shortcuts";

export function ChatKeyboardShortcutsScreen({
	termCols,
}: {
	readonly termCols: number;
}) {
	const shortcuts = useMemo(
		() => buildChatKeyboardShortcuts(detectTerminalProfile()),
		[],
	);

	return (
		<Box flexDirection="column" padding={1} width={termCols}>
			<Text bold>Keyboard shortcuts</Text>
			<Box marginTop={1} flexDirection="column">
				{shortcuts.map((shortcut, index) => (
					<Box
						key={shortcut.keys}
						marginTop={index === 0 ? 0 : 1}
						flexDirection="row"
						flexWrap="wrap"
					>
						<Text bold>{shortcut.keys} </Text>
						<Text dimColor>{shortcut.description}</Text>
					</Box>
				))}
			</Box>
			<Box marginTop={1} flexDirection="column">
				<Text dimColor>
					Type `/help` for slash commands. Esc or Enter to return.
				</Text>
			</Box>
		</Box>
	);
}
