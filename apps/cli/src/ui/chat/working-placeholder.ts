/** Spinner frames for in-progress transcript sub-lines (matches activity footer cadence). */
const WORKING_GLYPH_FRAMES = ["·", "•", "●", "•"] as const;

const WORKING_STATUS_LABEL = "Working…";

/** Stable placeholder in flattened rows; animated at render time. */
export const WORKING_PLACEHOLDER_SENTINEL = "\u0000WORKING\u0000";

export function formatTranscriptWorkingLine(frame: number): string {
	const glyph =
		WORKING_GLYPH_FRAMES[frame % WORKING_GLYPH_FRAMES.length] ?? "·";
	return `${glyph} ${WORKING_STATUS_LABEL}`;
}
