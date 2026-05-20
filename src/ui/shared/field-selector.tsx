import { Box, type Key, Text, useInput, useStdout } from "ink";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { ACCENT } from "../chat/constants";
import {
	type SelectChoice,
	clampSelectionIndex,
	filterSelectChoices,
	initialSelectionIndex,
	scrollOffsetForSelection,
} from "./field-selector-logic";
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

export type { SelectChoice };

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

function isFilterTypingInput(input: string, key: Key): boolean {
	if (!input || input.length !== 1) {
		return false;
	}
	if (
		key.ctrl ||
		key.meta ||
		key.return ||
		key.escape ||
		key.upArrow ||
		key.downArrow ||
		key.leftArrow ||
		key.rightArrow ||
		key.pageUp ||
		key.pageDown ||
		key.tab ||
		key.backspace ||
		key.delete
	) {
		return false;
	}
	return true;
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
	const resolvedChoices: SelectChoice[] = useMemo(
		() =>
			choices && choices.length > 0
				? [...choices]
				: (options ?? []).map((value) => ({ value, label: value })),
		[choices, options],
	);

	const [filterQuery, setFilterQuery] = useState("");
	const filteredChoices = useMemo(
		() => filterSelectChoices(resolvedChoices, filterQuery),
		[resolvedChoices, filterQuery],
	);

	const [sel, setSel] = useState(() =>
		initialSelectionIndex(resolvedChoices, currentValue),
	);
	const [scrollOffset, setScrollOffset] = useState(0);

	const { stdout } = useStdout();
	const chromeRows = 8;
	const terminalRows = stdout?.rows ?? 24;
	const visibleLines = Math.max(3, terminalRows - chromeRows);
	const totalLines = filteredChoices.length;
	const clampedSel = clampSelectionIndex(sel, totalLines);
	const effectiveScrollOffset = scrollOffsetForSelection(
		clampedSel,
		scrollOffset,
		visibleLines,
		totalLines,
	);
	const visibleChoices = filteredChoices.slice(
		effectiveScrollOffset,
		effectiveScrollOffset + visibleLines,
	);

	const scrollIndicator =
		totalLines > visibleLines
			? ` [${effectiveScrollOffset + 1}-${Math.min(effectiveScrollOffset + visibleLines, totalLines)}/${totalLines}]`
			: filteredChoices.length !== resolvedChoices.length
				? ` (${filteredChoices.length}/${resolvedChoices.length})`
				: "";

	useInput((input, key) => {
		if (key.backspace || key.delete) {
			if (filterQuery.length > 0) {
				setFilterQuery((q) => q.slice(0, -1));
				setSel(0);
				setScrollOffset(0);
			}
			return;
		}

		if (isCancelKey(input, key)) {
			if (filterQuery.length > 0) {
				setFilterQuery("");
				setSel(initialSelectionIndex(resolvedChoices, currentValue));
				setScrollOffset(0);
				return;
			}
			onCancel();
			return;
		}

		if (isSelectKey(input, key)) {
			const choice = filteredChoices[clampedSel];
			if (choice !== undefined) {
				onSubmit(choice.value);
			}
			return;
		}

		if (isNavigateUp(input, key) || key.leftArrow) {
			const nextSel = clampSelectionIndex(clampedSel - 1, totalLines);
			setSel(nextSel);
			setScrollOffset((offset) =>
				scrollOffsetForSelection(nextSel, offset, visibleLines, totalLines),
			);
			return;
		}

		if (isNavigateDown(input, key) || key.rightArrow) {
			const nextSel = clampSelectionIndex(clampedSel + 1, totalLines);
			setSel(nextSel);
			setScrollOffset((offset) =>
				scrollOffsetForSelection(nextSel, offset, visibleLines, totalLines),
			);
			return;
		}

		if (isFilterTypingInput(input, key)) {
			setFilterQuery((q) => q + input);
			setSel(0);
			setScrollOffset(0);
		}
	});

	return (
		<ViewFrame
			title={appTitle}
			subheader={subheader}
			footer={
				<Text dimColor>
					{UI_HINTS.selectFilter}
					{scrollIndicator}
				</Text>
			}
		>
			<Box marginBottom={1} paddingX={1}>
				<Text bold color={ACCENT}>
					Select: {fieldLabel}
				</Text>
			</Box>
			<Box marginBottom={1} paddingX={1}>
				<Text dimColor>
					Filter: {filterQuery}
					<Text color={ACCENT}>▌</Text>
				</Text>
			</Box>
			{visibleChoices.length === 0 ? (
				<Box paddingX={1}>
					<Text dimColor>No matches</Text>
				</Box>
			) : (
				visibleChoices.map((opt, i) => {
					const globalIndex = effectiveScrollOffset + i;
					return (
						<SelectableTextRow
							key={opt.value}
							selected={globalIndex === clampedSel}
							color="green"
						>
							{globalIndex === clampedSel ? UI_GLYPHS.section : " "} {
								opt.label
							}{" "}
						</SelectableTextRow>
					);
				})
			)}
		</ViewFrame>
	);
}
