import { Box } from "ink";
import type React from "react";
import { useCallback, useLayoutEffect, useState } from "react";
import { ACCENT, INPUT_BORDER } from "../chat/constants";
import { useTerminalLayout } from "./use-terminal-layout";
import { ViewHeader } from "./view-frame";

export type PaneFocus = "left" | "right";

const DEFAULT_LEFT_WIDTH = "40%";
/** Minimum columns reserved for the right pane when resolving widths. */
const MIN_RIGHT_PANE_COLS = 24;

export interface TwoPaneViewProps {
	readonly title: string;
	/**
	 * Content for the bottom status bar (typically the keyboard-shortcut hints).
	 * Rendered inside a bordered bar that is part of the layout, so its height is
	 * always accounted for when sizing the panes.
	 */
	readonly statusBar?: React.ReactNode;
	readonly subheader?: React.ReactNode;
	/** Which pane is currently focused (drives border highlight). */
	readonly focusedPane: PaneFocus;
	readonly left: React.ReactNode;
	readonly right: React.ReactNode;
	/**
	 * Left pane width in columns or as a percentage of the frame (e.g. `"40%"`).
	 * Defaults to `"40%"`.
	 */
	readonly leftWidth?: number | string;
	/**
	 * Cap the left pane at this many columns (after resolving `leftWidth`). Useful
	 * when a fixed fraction would be wider than the tree needs (e.g. configure).
	 */
	readonly leftMaxWidth?: number;
	/**
	 * Right pane width. When omitted, the right pane grows to fill the space left
	 * after the left pane (recommended with `leftMaxWidth`).
	 */
	readonly rightWidth?: number | string;
	/**
	 * Optional transient message (e.g. "Saved.") rendered just above the status
	 * bar. Like the rest of the chrome, it is part of the flex column and is
	 * accounted for in the height calculation.
	 */
	readonly status?: React.ReactNode;
}

/**
 * Shared master/detail two-pane layout used by the skills, configure, and
 * listen views. Owns the title bar, status bar, and focus-driven border
 * coloring so the visual shell can be updated in one place.
 *
 * The layout is a fixed-height flex column sized with {@link useTerminalLayout}
 * so it reflows when the terminal is resized. The header, subheader, transient
 * status line, and bottom status bar each take their natural size and are
 * marked `flexShrink={0}`, while the pane region grows to consume whatever is
 * left (`flexGrow` + `minHeight={0}`). Long pane content is clipped via
 * `overflow="hidden"` rather than expanding the column. Pane contents and
 * per-view navigation semantics remain the caller's responsibility (see
 * {@link useTwoPaneNavigation} for shared focus/index state).
 */
export function TwoPaneView({
	title,
	statusBar,
	subheader,
	focusedPane,
	left,
	right,
	leftWidth = DEFAULT_LEFT_WIDTH,
	leftMaxWidth,
	rightWidth,
	status,
}: TwoPaneViewProps) {
	const { termCols, frameHeight } = useTerminalLayout();
	const resolvedLeftWidth = resolveLeftPaneWidth(
		termCols,
		leftWidth,
		leftMaxWidth,
	);
	const rightFillsRemainder = rightWidth === undefined;

	return (
		<Box
			flexDirection="column"
			padding={1}
			width={termCols}
			height={frameHeight}
		>
			<ViewHeader title={title} />
			{subheader ? (
				<Box marginTop={1} flexShrink={0} justifyContent="center">
					{subheader}
				</Box>
			) : null}
			<Box
				marginTop={1}
				flexGrow={1}
				minHeight={0}
				overflow="hidden"
				borderStyle="single"
				borderColor={INPUT_BORDER}
				flexDirection="row"
			>
				<Box
					flexDirection="column"
					flexShrink={0}
					width={resolvedLeftWidth}
					overflow="hidden"
					borderStyle="single"
					borderColor={focusedPane === "left" ? ACCENT : "gray"}
				>
					{left}
				</Box>
				<Box
					flexDirection="column"
					flexGrow={rightFillsRemainder ? 1 : 0}
					flexShrink={rightFillsRemainder ? 1 : 0}
					minWidth={rightFillsRemainder ? 0 : undefined}
					width={rightFillsRemainder ? undefined : rightWidth}
					overflow="hidden"
					borderStyle="single"
					borderColor={focusedPane === "right" ? ACCENT : "gray"}
				>
					{right}
				</Box>
			</Box>
			{status ? (
				<Box marginTop={1} flexShrink={0} paddingX={1}>
					{status}
				</Box>
			) : null}
			{statusBar ? (
				<Box
					marginTop={1}
					flexShrink={0}
					borderStyle="single"
					borderColor={INPUT_BORDER}
					paddingX={1}
				>
					{statusBar}
				</Box>
			) : null}
		</Box>
	);
}

function percentToCols(termCols: number, spec: string): number {
	const pct = Number.parseFloat(spec) / 100;
	if (!Number.isFinite(pct)) {
		return Math.floor(termCols * 0.4);
	}
	return Math.max(1, Math.floor(termCols * pct));
}

function resolveLeftPaneWidth(
	termCols: number,
	leftWidth: number | string,
	leftMaxWidth?: number,
): number {
	let cols =
		typeof leftWidth === "number"
			? leftWidth
			: percentToCols(termCols, leftWidth);
	if (leftMaxWidth !== undefined) {
		cols = Math.min(cols, leftMaxWidth);
	}
	const maxLeft = Math.max(1, termCols - MIN_RIGHT_PANE_COLS);
	return Math.min(cols, maxLeft);
}

export interface UseTwoPaneNavigationResult {
	readonly focusedPane: PaneFocus;
	readonly setFocusedPane: React.Dispatch<React.SetStateAction<PaneFocus>>;
	readonly leftIndex: number;
	readonly setLeftIndex: React.Dispatch<React.SetStateAction<number>>;
	readonly rightIndex: number;
	readonly setRightIndex: React.Dispatch<React.SetStateAction<number>>;
	/**
	 * Toggle focus between panes. Pass `canFocusRight=false` to keep focus on
	 * the left pane (e.g. when the right pane currently has no items).
	 */
	readonly toggleFocus: (canFocusRight?: boolean) => void;
}

export interface UseTwoPaneNavigationOptions {
	/** Number of items in the left pane; used to clamp `leftIndex`. */
	readonly leftCount: number;
	/**
	 * When true (default), `rightIndex` resets to 0 whenever `leftIndex`
	 * changes, since a new left selection produces a fresh set of right items.
	 */
	readonly resetRightOnLeftChange?: boolean;
}

/**
 * Shared focus + selection state for a two-pane master/detail view:
 * - `leftIndex` is clamped whenever the left item count shrinks.
 * - `rightIndex` resets to 0 when the left selection changes (toggleable).
 * - `toggleFocus` flips the active pane (used by the Tab key handler).
 */
export function useTwoPaneNavigation({
	leftCount,
	resetRightOnLeftChange = true,
}: UseTwoPaneNavigationOptions): UseTwoPaneNavigationResult {
	const [focusedPane, setFocusedPane] = useState<PaneFocus>("left");
	const [leftIndex, setLeftIndex] = useState(0);
	const [rightIndex, setRightIndex] = useState(0);

	useLayoutEffect(() => {
		setLeftIndex((prev) => Math.min(prev, Math.max(0, leftCount - 1)));
	}, [leftCount]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional — reset right selection when the left selection changes
	useLayoutEffect(() => {
		if (resetRightOnLeftChange) setRightIndex(0);
	}, [leftIndex, resetRightOnLeftChange]);

	const toggleFocus = useCallback((canFocusRight = true) => {
		setFocusedPane((prev) =>
			prev === "left" ? (canFocusRight ? "right" : "left") : "left",
		);
	}, []);

	return {
		focusedPane,
		setFocusedPane,
		leftIndex,
		setLeftIndex,
		rightIndex,
		setRightIndex,
		toggleFocus,
	};
}
