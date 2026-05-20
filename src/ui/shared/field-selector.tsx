import { Box, Text, useInput } from "ink";
import type { ReactNode } from "react";
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

export type SelectChoice = {
	readonly value: string;
	readonly label: string;
};

export interface FieldSelectorProps {
	readonly appTitle: string;
	readonly fieldLabel: string;
	readonly options?: readonly string[];
	readonly choices?: readonly SelectChoice[];
	readonly currentValue?: string;
	readonly subheader?: ReactNode;
	readonly onSubmit: (value: string) => void;
	readonly onCancel: () => void;
}

export function FieldSelector({
	appTitle,
	fieldLabel,
	options,
	choices,
	currentValue,
	subheader,
	onSubmit,
	onCancel,
}: FieldSelectorProps) {
	const resolvedChoices: SelectChoice[] =
		choices && choices.length > 0
			? [...choices]
			: (options ?? []).map((value) => ({ value, label: value }));

	const [sel, setSel] = useState(() => {
		const current = currentValue ?? "";
		const idx = resolvedChoices.findIndex((c) => c.value === current);
		return idx >= 0 ? idx : 0;
	});

	useInput((input, key) => {
		if (isCancelKey(input, key)) {
			onCancel();
			return;
		}
		if (isSelectKey(input, key)) {
			const choice = resolvedChoices[sel];
			if (choice !== undefined) {
				onSubmit(choice.value);
			}
			return;
		}
		if (isNavigateUp(input, key) || key.leftArrow) {
			setSel((s) => Math.max(0, s - 1));
			return;
		}
		if (isNavigateDown(input, key) || key.rightArrow) {
			setSel((s) => Math.min(resolvedChoices.length - 1, s + 1));
		}
	});

	return (
		<ViewFrame
			title={appTitle}
			subheader={subheader}
			footer={<Text dimColor>{UI_HINTS.selectCancel}</Text>}
		>
			<Box marginBottom={1} paddingX={1}>
				<Text bold color={ACCENT}>
					Select: {fieldLabel}
				</Text>
			</Box>
			{resolvedChoices.map((opt, i) => (
				<SelectableTextRow key={opt.value} selected={i === sel} color="green">
					{i === sel ? UI_GLYPHS.section : " "} {opt.label}{" "}
				</SelectableTextRow>
			))}
		</ViewFrame>
	);
}
