import { Box, Text } from "ink";
import type { ReactNode } from "react";
import React from "react";
import { ASSISTANT_BOX_MARGIN_LEFT } from "../constants";
import type { DisplayRow } from "../types";
import { UserPromptRow } from "./user-prompt-row";

export function buildTranscriptNodes(
	rows: readonly DisplayRow[],
	termCols: number,
): ReactNode[] {
	const nodes: ReactNode[] = [];
	let i = 0;
	let outIdx = 0;
	const boxWidth = Math.max(12, termCols - ASSISTANT_BOX_MARGIN_LEFT);
	while (i < rows.length) {
		const r = rows[i];
		if (r.kind === "assistant_line" || r.kind === "assistant_list_item") {
			const bk = r.blockKey;
			const lines: Array<{ text: string; marker: string | null }> = [];
			while (i < rows.length) {
				const cur = rows[i];
				if (
					(cur.kind !== "assistant_line" &&
						cur.kind !== "assistant_list_item") ||
					cur.blockKey !== bk
				) {
					break;
				}
				if (cur.kind === "assistant_list_item") {
					lines.push({ text: cur.text, marker: cur.marker });
				} else {
					lines.push({ text: cur.text, marker: null });
				}
				i++;
			}
			nodes.push(
				<Box
					key={bk}
					marginLeft={ASSISTANT_BOX_MARGIN_LEFT}
					width={boxWidth}
					flexDirection="column"
					borderStyle="round"
					borderColor="gray"
					paddingX={1}
				>
					{lines.map((ln, j) => (
						<Text
							key={`${bk}-${j}-${ln.text.slice(0, 12)}`}
							wrap="truncate-end"
						>
							{ln.marker ? `${ln.marker}${ln.text || " "}` : (ln.text ?? " ")}
						</Text>
					))}
				</Box>,
			);
			outIdx++;
			continue;
		}
		if (r.kind === "spacer") {
			nodes.push(
				<Box key={r.rowKey} height={1}>
					<Text dimColor> </Text>
				</Box>,
			);
			i++;
			outIdx++;
			continue;
		}
		if (r.kind === "user") {
			nodes.push(
				<UserPromptRow
					key={`u-${outIdx}-${r.text.slice(0, 24)}`}
					text={r.text}
					width={termCols}
				/>,
			);
			i++;
			outIdx++;
			continue;
		}
		if (r.kind === "error") {
			nodes.push(
				<Box key={`e-${outIdx}-${r.text.slice(0, 80)}`} width={termCols}>
					<Text color="red" wrap="truncate-end">
						{r.text}
					</Text>
				</Box>,
			);
			i++;
			outIdx++;
			continue;
		}
		nodes.push(
			<Box key={`m-${outIdx}-${r.text.slice(0, 20)}`} width={termCols}>
				<Text dimColor wrap="truncate-end">
					{r.text}
				</Text>
			</Box>,
		);
		i++;
		outIdx++;
	}
	return nodes;
}
