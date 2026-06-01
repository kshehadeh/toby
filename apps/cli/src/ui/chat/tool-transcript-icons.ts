/**
 * Compact, non-emoji glyphs for transcript step headers.
 * Kept intentionally simple so they render well in most terminals.
 */
const TOOL_TRANSCRIPT_GLYPH = "↳";

/** Distinct from tool glyphs — used for assistant / model reply blocks. */
export const ASSISTANT_TRANSCRIPT_GLYPH = "◇";

/** Prompt prep + pipeline lifecycle rows in the transcript. */
export const PIPELINE_STEP_GLYPH = "›";

/** Informational meta rows emitted outside the pipeline event stream. */
export const META_STEP_GLYPH = "ℹ";

export function getToolTranscriptGlyph(_toolName: string): string {
	return TOOL_TRANSCRIPT_GLYPH;
}
