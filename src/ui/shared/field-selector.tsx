import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { ACCENT } from "../chat/constants";
import { UI_GLYPHS } from "./glyphs";
import {
	UI_HINTS,
	isCancelKey,
	isNavigateDown,
	isNavigateUp,
	isSelectKey,
} from "./keybindings";
import { SelectableTextRow } from "./rows";
import { ViewFrame } from "./view-frame";

export interface FieldSelectorProps {
	readonly appTitle: string;
	readonly fieldLabel: string;
	readonly options: readonly string[];
	readonly currentValue?: string;
	readonly onSubmit: (value: string) => void;
	readonly onCancel: () => void;
}

export function FieldSelector({
	appTitle,
	fieldLabel,
	options,
	currentValue,
	onSubmit,
	onCancel,
}: FieldSelectorProps) {
	const [sel, setSel] = useState(() => {
		const current = currentValue ?? "";
		const idx = options.indexOf(current);
		return idx >= 0 ? idx : 0;
	});

	useInput((input, key) => {
		if (isCancelKey(input, key)) {
			onCancel();
			return;
		}
		if (isSelectKey(input, key)) {
			const choice = options[sel];
			if (choice !== undefined) {
				onSubmit(choice);
			}
			return;
		}
		if (isNavigateUp(input, key) || key.leftArrow) {
			setSel((s) => Math.max(0, s - 1));
			return;
		}
		if (isNavigateDown(input, key) || key.rightArrow) {
			setSel((s) => Math.min(options.length - 1, s + 1));
		}
	});

	return (
		<ViewFrame
			title={appTitle}
			footer={<Text dimColor>{UI_HINTS.selectCancel}</Text>}
		>
			<Box marginBottom={1} paddingX={1}>
				<Text bold color={ACCENT}>
					Select: {fieldLabel}
				</Text>
			</Box>
			{options.map((opt, i) => (
				<SelectableTextRow key={opt} selected={i === sel} color="green">
					{i === sel ? UI_GLYPHS.section : " "} {opt}{" "}
				</SelectableTextRow>
			))}
		</ViewFrame>
	);
}
