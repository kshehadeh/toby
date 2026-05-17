import { Box, Text, useInput } from "ink";
import React from "react";
import { UI_HINTS, isCancelKey, isConfirmKey } from "./keybindings";
import { ViewFrame } from "./view-frame";

export interface ConfirmDialogProps {
	readonly title: string;
	readonly message: string;
	readonly onConfirm: () => void;
	readonly onCancel: () => void;
}

export function ConfirmDialog({
	title,
	message,
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
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
		<ViewFrame title={title} footer={<Text dimColor>{UI_HINTS.confirm}</Text>}>
			<Box paddingX={1}>
				<Text bold color="yellow">
					{message}
				</Text>
			</Box>
		</ViewFrame>
	);
}
