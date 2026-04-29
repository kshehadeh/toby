/**
 * Compact, non-emoji glyphs for transcript step headers.
 * Kept intentionally simple so they render well in most terminals.
 */
const TOOL_TRANSCRIPT_GLYPH = "↳";

/** Distinct from tool glyphs — used for assistant / model reply blocks. */
export const ASSISTANT_TRANSCRIPT_GLYPH = "◇";

export function getToolTranscriptGlyph(_toolName: string): string {
	return TOOL_TRANSCRIPT_GLYPH;
}
