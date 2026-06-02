import { Box, useWindowSize } from "ink";
import React, { useMemo } from "react";
import type { DisplayRow } from "../types";
import {
	WORKING_PLACEHOLDER_SENTINEL,
	formatTranscriptWorkingLine,
} from "../working-placeholder";
import { buildTranscriptNodes } from "./transcript";

/** Reserve lines for header, activity, input dock, and margins. */
const VIEWPORT_CHROME_ROWS = 14;
const MIN_VISIBLE_TRANSCRIPT_ROWS = 48;
const MAX_VISIBLE_TRANSCRIPT_ROWS = 400;

function maxVisibleTranscriptRows(terminalRows: number): number {
	const budget = terminalRows - VIEWPORT_CHROME_ROWS;
	return Math.min(
		MAX_VISIBLE_TRANSCRIPT_ROWS,
		Math.max(MIN_VISIBLE_TRANSCRIPT_ROWS, budget),
	);
}

function windowDisplayRows(
	rows: readonly DisplayRow[],
	maxVisible: number,
): readonly DisplayRow[] {
	if (rows.length <= maxVisible) {
		return rows;
	}
	const keep = Math.max(1, maxVisible - 1);
	const hiddenCount = rows.length - keep;
	return [
		{
			kind: "meta",
			text: `↑ ${hiddenCount} earlier line(s) hidden — scroll terminal scrollback for full history`,
		},
		...rows.slice(-keep),
	];
}

/** Apply animated working glyph to sentinel lines without re-flattening the transcript. */
function applyWorkingAnimation(
	rows: readonly DisplayRow[],
	animFrame: number,
): readonly DisplayRow[] {
	const workingLine = formatTranscriptWorkingLine(animFrame);
	const next: DisplayRow[] = [];
	for (const row of rows) {
		if (row.kind === "boxed_block") {
			let rowChanged = false;
			const bodyLines = row.bodyLines.map((line) => {
				if (line === WORKING_PLACEHOLDER_SENTINEL) {
					rowChanged = true;
					return workingLine;
				}
				return line;
			});
			if (rowChanged) {
				next.push({ ...row, bodyLines });
				continue;
			}
		}
		if (
			row.kind === "tool_feedback_output" &&
			row.detail === WORKING_PLACEHOLDER_SENTINEL
		) {
			next.push({ ...row, detail: workingLine });
			continue;
		}
		next.push(row);
	}
	return next;
}

export type ChatTranscriptPanelProps = {
	readonly rows: readonly DisplayRow[];
	readonly termCols: number;
	readonly animFrame: number;
};

function ChatTranscriptPanelInner({
	rows,
	termCols,
	animFrame,
}: ChatTranscriptPanelProps) {
	const { rows: terminalRows = 24 } = useWindowSize();
	const maxVisible = maxVisibleTranscriptRows(terminalRows);

	const visibleRows = useMemo(() => {
		const windowed = windowDisplayRows(rows, maxVisible);
		return applyWorkingAnimation(windowed, animFrame);
	}, [rows, maxVisible, animFrame]);

	const nodes = useMemo(
		() => buildTranscriptNodes(visibleRows, termCols),
		[visibleRows, termCols],
	);

	return (
		<Box flexDirection="column" marginTop={1} flexShrink={0}>
			{nodes}
		</Box>
	);
}

export const ChatTranscriptPanel = React.memo(ChatTranscriptPanelInner);
