import {
	Box,
	measureElement,
	Spacer,
	Text,
	useAnimation,
	type DOMElement,
	type TextProps,
} from "ink";
import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import {
	buildInputSegments,
	type CursorStyle,
	type SegmentType,
	type TextSegment,
} from "./controlled-multiline-input-segments";
import { UI_GLYPHS } from "./glyphs";

function expandTabs(text: string, tabSize: number): string {
	return text.replace(/\t/g, " ".repeat(tabSize));
}

function normalizeLineEndings(text: string | null | undefined): string {
	if (text == null) {
		return "";
	}
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function MeasureBox({
	children,
	onHeightChange,
}: {
	readonly children: ReactNode;
	readonly onHeightChange?: (height: number) => void;
}) {
	const ref = useRef<DOMElement>(null);
	const lastHeightRef = useRef<number | undefined>(undefined);

	useEffect(() => {
		if (ref.current) {
			const { height } = measureElement(ref.current);
			if (lastHeightRef.current !== height) {
				lastHeightRef.current = height;
				onHeightChange?.(height);
			}
		}
	});

	return (
		<Box ref={ref} flexShrink={0} flexGrow={0} width="100%">
			{children}
		</Box>
	);
}

export interface ControlledMultilineInputProps {
	readonly value: string;
	readonly rows?: number;
	readonly maxRows?: number;
	readonly highlightStyle?: TextProps;
	readonly textStyle?: TextProps;
	readonly placeholder?: string;
	readonly mask?: string;
	readonly showCursor?: boolean;
	readonly focus?: boolean;
	readonly tabSize?: number;
	readonly cursorIndex?: number;
	readonly highlight?: { readonly start: number; readonly end: number };
	readonly refreshKey?: unknown;
	readonly cursorColor?: string;
	readonly cursorGlyph?: string;
	readonly cursorStyle?: CursorStyle;
}

export function ControlledMultilineInput({
	value,
	rows,
	maxRows,
	highlightStyle,
	textStyle,
	placeholder = "",
	mask,
	showCursor = true,
	focus = true,
	tabSize = 4,
	cursorIndex = 0,
	highlight,
	refreshKey,
	cursorColor = "white",
	cursorGlyph = UI_GLYPHS.inputCursor,
	cursorStyle = "block",
}: ControlledMultilineInputProps) {
	const [scrollOffset, setScrollOffset] = useState(0);
	const [contentHeight, setContentHeight] = useState(0);
	const [markerHeight, setMarkerHeight] = useState(0);
	const { frame: cursorFrame } = useAnimation({
		interval: 530,
		isActive: showCursor && focus,
	});
	const cursorVisible = cursorFrame % 2 === 0;

	const formatText = useCallback(
		(text: string, isPlaceholder = false) => {
			const normalized = normalizeLineEndings(text);
			if (!isPlaceholder && mask) {
				return normalized.replace(/[^\n]/g, mask);
			}
			return expandTabs(normalized, tabSize);
		},
		[tabSize, mask],
	);

	const { preCursor, postCursor } = useMemo(
		(): { preCursor: TextSegment[]; postCursor: TextSegment[] } =>
			buildInputSegments({
				value,
				cursorIndex,
				focus,
				showCursor,
				cursorVisible,
				cursorStyle,
				cursorGlyph,
				placeholder,
				highlight,
				formatText,
			}),
		[
			cursorIndex,
			showCursor,
			focus,
			value,
			placeholder,
			mask,
			highlight,
			formatText,
			refreshKey,
			cursorGlyph,
			cursorVisible,
			cursorStyle,
		],
	);

	const visibleRows = useMemo(() => {
		if (contentHeight !== undefined) {
			return Math.max(
				rows ?? maxRows ?? 1,
				Math.min(maxRows ?? rows ?? 1, contentHeight),
			);
		}
		return 1;
	}, [rows, maxRows, contentHeight]);

	useEffect(() => {
		if (markerHeight !== undefined && visibleRows !== undefined) {
			const cursorLineEnd = markerHeight;
			setScrollOffset((prevOffset) => {
				const viewportStart = prevOffset;
				const viewportEnd = prevOffset + visibleRows;
				if (cursorLineEnd <= viewportStart) {
					return Math.max(0, cursorLineEnd - 1);
				}
				if (cursorLineEnd > viewportEnd) {
					return cursorLineEnd - visibleRows;
				}
				if (contentHeight) {
					if (contentHeight < visibleRows) {
						return 0;
					}
					if (contentHeight < viewportEnd) {
						return contentHeight - visibleRows;
					}
				}
				return prevOffset;
			});
		}
	}, [markerHeight, visibleRows, contentHeight]);

	const getStyle = useCallback(
		(type?: SegmentType): TextProps => {
			switch (type) {
				case "placeholder":
					return { ...textStyle, dimColor: true };
				case "highlight":
					return highlightStyle ?? textStyle ?? {};
				case "cursor":
					return cursorStyle === "block"
						? { ...(highlightStyle ?? textStyle), inverse: true }
						: {
								...(highlightStyle ?? textStyle),
								color: cursorColor,
								inverse: false,
							};
				default:
					return textStyle ?? {};
			}
		},
		[textStyle, highlightStyle, cursorColor, cursorStyle],
	);

	const renderSegments = (segments: TextSegment[]) =>
		segments.map((segment, idx) => (
			<Text key={idx} {...getStyle(segment.type)}>
				{segment.value}
			</Text>
		));

	return (
		<Box
			height={visibleRows}
			overflow="hidden"
			flexDirection="column"
			flexGrow={0}
			flexShrink={0}
		>
			<Box flexDirection="column">
				<Box
					height={visibleRows}
					overflowY="hidden"
					flexShrink={0}
					flexDirection="column"
				>
					<Box marginTop={-scrollOffset} flexDirection="column">
						<MeasureBox onHeightChange={setContentHeight}>
							<Text>
								{renderSegments(preCursor)}
								{renderSegments(postCursor)}
							</Text>
						</MeasureBox>
					</Box>
					<Spacer />
				</Box>
				<MeasureBox onHeightChange={setMarkerHeight}>
					<Text>{renderSegments(preCursor)}</Text>
				</MeasureBox>
			</Box>
		</Box>
	);
}
