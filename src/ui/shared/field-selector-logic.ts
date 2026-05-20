export type SelectChoice = {
	readonly value: string;
	readonly label: string;
};

export function filterSelectChoices(
	choices: readonly SelectChoice[],
	query: string,
): SelectChoice[] {
	const trimmed = query.trim();
	if (!trimmed) {
		return [...choices];
	}
	const q = trimmed.toLowerCase();
	return choices.filter(
		(c) =>
			c.value.toLowerCase().includes(q) || c.label.toLowerCase().includes(q),
	);
}

export function clampSelectionIndex(index: number, length: number): number {
	if (length <= 0) {
		return 0;
	}
	return Math.max(0, Math.min(index, length - 1));
}

export function scrollOffsetForSelection(
	sel: number,
	scrollOffset: number,
	visibleLines: number,
	total: number,
): number {
	if (total <= visibleLines) {
		return 0;
	}
	if (sel < scrollOffset) {
		return sel;
	}
	if (sel >= scrollOffset + visibleLines) {
		return sel - visibleLines + 1;
	}
	return scrollOffset;
}

export function initialSelectionIndex(
	choices: readonly SelectChoice[],
	currentValue: string | undefined,
): number {
	const current = currentValue ?? "";
	const idx = choices.findIndex((c) => c.value === current);
	return idx >= 0 ? idx : 0;
}
