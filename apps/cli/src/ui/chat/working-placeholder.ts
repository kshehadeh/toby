import { dotGridSpinnerFrame } from "../shared/dot-grid-spinner";

const WORKING_STATUS_LABEL = "Working…";

/** Stable placeholder in flattened rows; animated at render time. */
export const WORKING_PLACEHOLDER_SENTINEL = "\u0000WORKING\u0000";

export function formatTranscriptWorkingLine(frame: number): string {
	return `${dotGridSpinnerFrame(frame)} ${WORKING_STATUS_LABEL}`;
}
