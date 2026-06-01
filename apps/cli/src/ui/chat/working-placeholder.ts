/** Spinner frames for in-progress transcript sub-lines (matches activity footer cadence). */
const WORKING_GLYPH_FRAMES = ["·", "•", "●", "•"] as const;

const WORKING_STATUS_LABEL = "Working…";

export function formatTranscriptWorkingLine(frame: number): string {
	const glyph =
		WORKING_GLYPH_FRAMES[frame % WORKING_GLYPH_FRAMES.length] ?? "·";
	return `${glyph} ${WORKING_STATUS_LABEL}`;
}
