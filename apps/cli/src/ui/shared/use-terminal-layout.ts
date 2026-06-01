import { useWindowSize } from "ink";

const MIN_FRAME_HEIGHT = 8;
const MIN_TERM_COLS = 24;
/** One row of breathing room so the layout does not scroll past the terminal edge. */
const BOTTOM_RESERVED_ROWS = 1;
/** Shrink the frame vs. terminal height so chrome + status bar fit without overflow. */
const LAYOUT_HEIGHT_TRIM_ROWS = 2;
/** Matches root `padding={1}` on full-screen frames (one column each side). */
const FRAME_PADDING_COLS = 2;

export interface TerminalLayout {
	readonly columns: number;
	readonly rows: number;
	/** Usable width inside a frame with horizontal padding. */
	readonly termCols: number;
	/** Usable height for a flex-filled full-screen frame. */
	readonly frameHeight: number;
}

/**
 * Tracks terminal columns/rows and re-renders when the user resizes the
 * window (Ink subscribes to stdout `resize`).
 */
export function useTerminalLayout(): TerminalLayout {
	const { columns, rows } = useWindowSize();
	const termCols = Math.max(MIN_TERM_COLS, columns - FRAME_PADDING_COLS);
	const frameHeight = Math.max(
		MIN_FRAME_HEIGHT,
		rows - BOTTOM_RESERVED_ROWS - LAYOUT_HEIGHT_TRIM_ROWS,
	);
	return { columns, rows, termCols, frameHeight };
}
