import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { useState } from "react";
import { ACCENT } from "../chat/constants";
import { MultilineTextEdit } from "./multiline-text-edit";
import { ViewFrame } from "./view-frame";

export interface FieldEditorProps {
	readonly appTitle: string;
	readonly fieldLabel: string;
	readonly value: string;
	readonly multiline?: boolean;
	readonly masked?: boolean;
	readonly placeholder?: string;
	readonly subheader?: ReactNode;
	readonly onSubmit: (value: string) => void;
	readonly onCancel: () => void;
}

export function FieldEditor({
	appTitle,
	fieldLabel,
	value: initialValue,
	multiline = false,
	masked = false,
	placeholder,
	subheader,
	onSubmit,
	onCancel,
}: FieldEditorProps) {
	const [value, setValue] = useState(initialValue);
	const [cursorResetToken, setCursorResetToken] = useState(0);

	return (
		<ViewFrame
			title={appTitle}
			subheader={subheader}
			footer={
				<Text dimColor>
					{multiline
						? "Enter new line · ↑↓ navigate lines · Ctrl+S save · Esc cancel"
						: "Type value · Enter save · Esc cancel"}
				</Text>
			}
		>
			<Box marginBottom={1} paddingX={1}>
				<Text bold color={ACCENT}>
					Edit: {fieldLabel}
				</Text>
			</Box>
			<Box paddingX={1}>
				<MultilineTextEdit
					width="100%"
					value={value}
					onChange={setValue}
					onSubmit={(next) => {
						onSubmit(next);
						setCursorResetToken((token) => token + 1);
					}}
					focus
					accentColor={ACCENT}
					rows={1}
					maxRows={multiline ? 8 : 1}
					placeholder={
						masked && value.length > 0
							? "•".repeat(value.length)
							: (placeholder ?? "Enter value…")
					}
					cursorResetToken={cursorResetToken}
					enterMode={multiline ? "newline" : "submit"}
					onCancel={onCancel}
					showStaticPlaceholder={masked}
				/>
			</Box>
		</ViewFrame>
	);
}
