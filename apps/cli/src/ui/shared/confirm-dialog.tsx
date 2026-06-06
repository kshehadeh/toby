import { Box, Text, useInput } from "ink";
import { ACCENT } from "../chat/constants";
import { UI_HINTS, isCancelKey, isConfirmKey } from "./keybindings";
import { useTerminalLayout } from "./use-terminal-layout";
import { ViewModal } from "./view-modal";

export interface ConfirmDialogProps {
	/** Unused — kept for call-site compatibility; the parent view title stays visible. */
	readonly title?: string;
	readonly message: string;
	readonly onConfirm: () => void;
	readonly onCancel: () => void;
}

/**
 * Compact confirmation overlay rendered on top of the current view (does not
 * replace the layout). Handles y/Enter confirm and Esc cancel via {@link useInput}.
 */
export function ConfirmDialog({
	message,
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
	const { termCols } = useTerminalLayout();

	useInput((input, key) => {
		if (isConfirmKey(input, key)) {
			onConfirm();
			return;
		}
		if (isCancelKey(input, key)) {
			onCancel();
		}
	});

	return (
		<Box flexShrink={0} width={termCols} flexDirection="column">
			<ViewModal termCols={termCols} borderColor={ACCENT}>
				<Text bold color="yellow" wrap="wrap">
					{message}
				</Text>
				<Box marginTop={1}>
					<Text dimColor>{UI_HINTS.confirm}</Text>
				</Box>
			</ViewModal>
		</Box>
	);
}
