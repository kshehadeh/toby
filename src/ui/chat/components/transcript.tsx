import { Box, Text } from "ink";
import type { ReactNode } from "react";
import React from "react";
import {
	ACCENT,
	ASSISTANT_BOX_MARGIN_LEFT,
	BOXED_STEP_BODY_MARGIN_LEFT,
	TOOL_FEEDBACK_DETAIL_INDENT,
} from "../constants";
import { AssistantMarkdownLine, MarkdownInlineText } from "../markdown-inline";
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
		if (r.kind === "boxed_block") {
			const bb = r;
			const bodyDim = bb.variant !== "assistant";
			nodes.push(
				<Box
					key={`bb-${bb.id}-${outIdx}`}
					flexDirection="column"
					width={termCols}
					marginBottom={0}
				>
					<Box
						marginLeft={2}
						width={Math.max(12, termCols - 2)}
						flexDirection="column"
					>
						<Text wrap="truncate-end">
							<Text color={ACCENT}>{bb.leadingGlyph}</Text>
							<Text> </Text>
							<Text bold color={ACCENT}>
								{bb.header}
							</Text>
							{bb.variant === "tool" && bb.cacheHit ? (
								<Text dimColor> [cache]</Text>
							) : null}
						</Text>
						<Box
							marginLeft={BOXED_STEP_BODY_MARGIN_LEFT}
							marginTop={0}
							flexDirection="column"
						>
							{bb.bodyLines.map((line, j) =>
								bb.variant === "assistant" ? (
									<MarkdownInlineText
										key={`${bb.id}-ln-${j}`}
										line={line}
										dimColor={bodyDim}
									/>
								) : (
									<Text
										key={`${bb.id}-ln-${j}`}
										dimColor={bodyDim}
										wrap="truncate-end"
									>
										{line.length > 0 ? line : " "}
									</Text>
								),
							)}
						</Box>
					</Box>
				</Box>,
			);
			i++;
			outIdx++;
			continue;
		}
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
						<AssistantMarkdownLine
							key={`${bk}-${j}-${ln.text.slice(0, 12)}`}
							marker={ln.marker}
							text={ln.text ?? ""}
						/>
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
		if (r.kind === "ask_user_qa") {
			const ask = r;
			const err = ask.error;
			nodes.push(
				<Box
					key={`ask-${ask.blockKey}-${outIdx}`}
					marginLeft={2}
					width={Math.max(12, termCols - 2)}
					flexDirection="column"
					paddingX={1}
					backgroundColor="black"
					marginBottom={1}
					borderStyle="round"
					borderColor="gray"
				>
					<Text wrap="wrap">
						<Text color="blue">[Q] </Text>
						<Text bold color="white">
							{ask.query}
						</Text>
					</Text>
					{err !== undefined && err.length > 0 ? (
						<Text color="red" wrap="wrap">
							{err}
						</Text>
					) : (
						<Text color="white" wrap="wrap">
							{ask.answer}
						</Text>
					)}
				</Box>,
			);
			i++;
			outIdx++;
			continue;
		}
		if (r.kind === "tool_feedback_call") {
			const bk = r.blockKey;
			const title = r.title;
			const detailLines: string[] = [];
			i++;
			while (i < rows.length) {
				const cur = rows[i];
				if (cur.kind === "tool_feedback_output" && cur.blockKey === bk) {
					detailLines.push(cur.detail);
					i++;
				} else {
					break;
				}
			}
			const detailMargin = 2 + TOOL_FEEDBACK_DETAIL_INDENT;
			nodes.push(
				<Box
					key={`tf-${bk}-${outIdx}`}
					flexDirection="column"
					width={termCols}
					marginBottom={0}
				>
					<Box marginLeft={2} width={termCols}>
						<Text color={ACCENT} bold wrap="truncate-end">{`> ${title}`}</Text>
					</Box>
					{detailLines.length > 0 ? (
						<Box marginLeft={detailMargin} width={termCols}>
							<Text dimColor wrap="truncate-end">
								{detailLines.join("\n")}
							</Text>
						</Box>
					) : null}
				</Box>,
			);
			outIdx++;
			continue;
		}
		if (r.kind === "tool_feedback_output") {
			const orphan = r;
			nodes.push(
				<Box
					key={`tf-orphan-${outIdx}-${orphan.blockKey}`}
					marginLeft={2 + TOOL_FEEDBACK_DETAIL_INDENT}
					width={termCols}
				>
					<Text dimColor wrap="truncate-end">
						{orphan.detail}
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
