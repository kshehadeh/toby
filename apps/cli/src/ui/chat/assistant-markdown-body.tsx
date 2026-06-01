import { Box } from "ink";
import type { ReactElement, ReactNode } from "react";
import { AssistantMarkdownLine, MarkdownInlineText } from "./markdown-inline";
import { segmentMarkdownLines } from "./markdown-table";
import { MarkdownTableView } from "./markdown-table-view";

export type AssistantMarkdownLineInput = {
	readonly text: string;
	readonly marker: string | null;
};

export function renderAssistantMarkdownLines(
	lines: readonly AssistantMarkdownLineInput[],
	maxWidth: number,
	options?: { readonly dimColor?: boolean },
): ReactNode[] {
	const dimColor = options?.dimColor;
	const plainLines = lines.map((ln) => ln.text);
	const segments = segmentMarkdownLines(plainLines);
	const nodes: ReactNode[] = [];
	let lineIdx = 0;

	for (const segment of segments) {
		if (segment.kind === "table") {
			nodes.push(
				<Box key={`table-${lineIdx}`} flexDirection="column" marginY={0}>
					<MarkdownTableView
						rows={segment.rows}
						maxWidth={maxWidth}
						dimColor={dimColor}
					/>
				</Box>,
			);
			lineIdx += segment.lineCount;
			continue;
		}

		const ln = lines[lineIdx];
		if (!ln) {
			break;
		}
		nodes.push(
			<AssistantMarkdownLine
				key={`ln-${lineIdx}-${ln.text.slice(0, 12)}`}
				marker={ln.marker}
				text={ln.text}
				dimColor={dimColor}
			/>,
		);
		lineIdx += segment.lineCount;
	}
	return nodes;
}

export function renderMarkdownBodyLines(
	lines: readonly string[],
	maxWidth: number,
	options?: { readonly dimColor?: boolean },
): ReactElement {
	const dimColor = options?.dimColor;
	const segments = segmentMarkdownLines(lines);
	const nodes: ReactNode[] = [];
	let lineIdx = 0;

	for (const segment of segments) {
		if (segment.kind === "table") {
			nodes.push(
				<Box key={`table-${lineIdx}`} flexDirection="column" marginY={0}>
					<MarkdownTableView
						rows={segment.rows}
						maxWidth={maxWidth}
						dimColor={dimColor}
					/>
				</Box>,
			);
			lineIdx += segment.lineCount;
			continue;
		}
		nodes.push(
			<MarkdownInlineText
				key={`ln-${lineIdx}-${segment.line.slice(0, 12)}`}
				line={segment.line}
				dimColor={dimColor}
			/>,
		);
		lineIdx += segment.lineCount;
	}
	return <>{nodes}</>;
}
