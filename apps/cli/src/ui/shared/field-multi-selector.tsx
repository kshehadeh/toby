import { Box, type Key, Text, useInput } from "ink";
import { useMemo, useState } from "react";
import { ACCENT } from "../chat/constants";
import {
	type SelectChoice,
	clampSelectionIndex,
	filterSelectChoices,
	scrollOffsetForSelection,
} from "./field-selector-logic";
import { UI_GLYPHS } from "./glyphs";
import {
	isCancelKey,
	isNavigateDown,
	isNavigateUp,
	isSelectKey,
	isToggleKey,
} from "./keybindings";
import { SelectableTextRow } from "./rows";
import { useTerminalLayout } from "./use-terminal-layout";
import { ViewFrame } from "./view-frame";

export interface FieldMultiSelectorProps {
	readonly appTitle: string;
	readonly fieldLabel: string;
	readonly options?: readonly string[];
	readonly choices?: readonly SelectChoice[];
	readonly selectedValues: readonly string[];
	readonly subheader?: React.ReactNode;
	readonly onSubmit: (values: string[]) => void;
	readonly onCancel: () => void;
}

function isFilterTypingInput(input: string, key: Key): boolean {
	if (!input || input.length !== 1) return false;
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
	)
		return false;
	return true;
}

export function FieldMultiSelector({
	appTitle,
	fieldLabel,
	options,
	choices,
	selectedValues,
	subheader,
	onSubmit,
	onCancel,
}: FieldMultiSelectorProps) {
	const resolvedChoices: SelectChoice[] = useMemo(
		() =>
			choices && choices.length > 0
				? [...choices]
				: (options ?? []).map((value) => ({ value, label: value })),
		[choices, options],
	);

	const [toggled, setToggled] = useState<Set<string>>(
		() => new Set(selectedValues),
	);
	const [filterQuery, setFilterQuery] = useState("");
	const filteredChoices = useMemo(
		() => filterSelectChoices(resolvedChoices, filterQuery),
		[resolvedChoices, filterQuery],
	);

	const [sel, setSel] = useState(0);
	const [scrollOffset, setScrollOffset] = useState(0);

	const { rows } = useTerminalLayout();
	const chromeRows = 8;
	const visibleLines = Math.max(3, rows - chromeRows);
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
				setSel(0);
				setScrollOffset(0);
				return;
			}
			onCancel();
			return;
		}

		if (isToggleKey(input, key)) {
			const choice = filteredChoices[clampedSel];
			if (choice !== undefined) {
				setToggled((prev) => {
					const next = new Set(prev);
					if (next.has(choice.value)) {
						next.delete(choice.value);
					} else {
						next.add(choice.value);
					}
					return next;
				});
			}
			return;
		}

		if (isSelectKey(input, key)) {
			onSubmit([...toggled]);
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

	const selectedCount = toggled.size;

	return (
		<ViewFrame
			title={appTitle}
			subheader={subheader}
			footer={
				<Text dimColor>Space toggle · Enter confirm · {scrollIndicator}</Text>
			}
		>
			<Box marginBottom={1} paddingX={1}>
				<Text bold color={ACCENT}>
					Select: {fieldLabel}
				</Text>
				<Text dimColor> ({selectedCount} selected)</Text>
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
					const isChecked = toggled.has(opt.value);
					return (
						<SelectableTextRow
							key={opt.value}
							selected={globalIndex === clampedSel}
							color="green"
						>
							{globalIndex === clampedSel ? UI_GLYPHS.section : " "}{" "}
							<Text color={isChecked ? "green" : undefined}>
								{isChecked ? "☑" : "☐"}
							</Text>{" "}
							{opt.label}
						</SelectableTextRow>
					);
				})
			)}
		</ViewFrame>
	);
}
