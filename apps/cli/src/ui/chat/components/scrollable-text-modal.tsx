import { Box, Text, useWindowSize } from "ink";
import React from "react";
import { ViewModal } from "../../shared";
import { META_ACCENT } from "../constants";

const MODAL_CHROME_ROWS = 8;

function logLineColor(line: string): string | undefined {
	if (line === "Log is empty.") {
		return undefined;
	}
	const level = line[9];
	if (level === "E") {
		return "red";
	}
	if (level === "W") {
		return "yellow";
	}
	return undefined;
}

export type ScrollableTextModalProps = {
	readonly termCols: number;
	readonly title: string;
	readonly lines: readonly string[];
	readonly scrollOffset: number;
	readonly lineTone?: "log" | "default";
};

export function ScrollableTextModal({
	termCols,
	title,
	lines,
	scrollOffset,
	lineTone = "default",
}: ScrollableTextModalProps) {
	const { rows: terminalRows = 24 } = useWindowSize();
	const visibleLineBudget = scrollModalVisibleLineBudget(terminalRows);
	const visible = lines.slice(scrollOffset, scrollOffset + visibleLineBudget);
	const contentWidth = Math.max(12, termCols - 4);

	const scrollIndicator =
		lines.length > visibleLineBudget
			? ` · ${scrollOffset + 1}-${Math.min(
					scrollOffset + visibleLineBudget,
					lines.length,
				)}/${lines.length}`
			: "";

	return (
		<ViewModal termCols={termCols} borderColor={META_ACCENT}>
			<Box width={contentWidth}>
				<Text bold wrap="truncate-end">
					{title}
					{scrollIndicator}
				</Text>
			</Box>
			<Box marginTop={1} flexDirection="column" width={contentWidth}>
				{visible.map((line, index) => {
					const color = lineTone === "log" ? logLineColor(line) : undefined;
					return (
						<Text
							key={`scroll-${scrollOffset + index}-${line.slice(0, 24)}`}
							wrap="wrap"
							{...(color !== undefined ? { color } : { dimColor: true })}
						>
							{line}
						</Text>
					);
				})}
			</Box>
			<Box marginTop={1} width={contentWidth}>
				<Text dimColor wrap="truncate-end">
					↑↓ scroll · Esc or Enter to close
				</Text>
			</Box>
		</ViewModal>
	);
}

export function maxScrollModalOffset(
	lineCount: number,
	visibleLineBudget: number,
): number {
	return Math.max(0, lineCount - visibleLineBudget);
}

export function scrollModalVisibleLineBudget(terminalRows: number): number {
	return Math.max(4, Math.min(20, terminalRows - MODAL_CHROME_ROWS));
}
