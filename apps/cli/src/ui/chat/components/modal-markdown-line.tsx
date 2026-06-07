import { Text } from "ink";
import type { ReactElement } from "react";
import { META_ACCENT } from "../constants";
import {
	isDimModalHintLine,
	parseModalInlinePieces,
	splitStatusGlyphPrefix,
} from "../modal-markdown";
import {
	parseMarkdownHeading,
	renderInlineMarkdownChildren,
} from "../markdown-inline";

const HEADING_COLOR = "cyan";

function renderInlinePieces(
	pieces: ReturnType<typeof parseModalInlinePieces>,
	options?: { readonly dimColor?: boolean },
): ReactElement {
	return (
		<>
			{renderInlineMarkdownChildren(pieces, {
				dimColor: options?.dimColor,
				pieceColor: (piece) => piece.color,
			})}
		</>
	);
}

export function ModalMarkdownLine(props: {
	readonly line: string;
}): ReactElement {
	const { line } = props;

	if (line.trim().length === 0) {
		return <Text> </Text>;
	}

	if (isDimModalHintLine(line)) {
		return (
			<Text wrap="wrap" dimColor>
				{line}
			</Text>
		);
	}

	const statusPrefix = splitStatusGlyphPrefix(line);
	if (statusPrefix) {
		const pieces = parseModalInlinePieces(statusPrefix.body);
		return (
			<Text wrap="wrap">
				<Text dimColor>{statusPrefix.indent}</Text>
				<Text color={statusPrefix.glyphColor}>{statusPrefix.glyph} </Text>
				{renderInlinePieces(pieces)}
			</Text>
		);
	}

	const heading = parseMarkdownHeading(line);
	if (heading) {
		return (
			<Text wrap="wrap">
				<Text bold color={HEADING_COLOR}>
					{heading.text}
				</Text>
			</Text>
		);
	}

	const indented = line.match(/^(\s+)(.*)$/);
	if (indented && !line.trimStart().startsWith("#")) {
		const indent = indented[1] ?? "";
		const body = indented[2] ?? "";
		if (body.startsWith("/") || body.startsWith("~")) {
			return (
				<Text wrap="wrap">
					<Text dimColor>{indent}</Text>
					<Text color={META_ACCENT}>{body}</Text>
				</Text>
			);
		}
		const pieces = parseModalInlinePieces(body);
		return (
			<Text wrap="wrap">
				<Text dimColor>{indent}</Text>
				{renderInlinePieces(pieces, { dimColor: true })}
			</Text>
		);
	}

	const pieces = parseModalInlinePieces(line);
	return <Text wrap="wrap">{renderInlinePieces(pieces)}</Text>;
}
