export const UI_GLYPHS = {
	cursor: "› ",
	spacer: "  ",
	section: "▸",
	action: "+",
	edit: "[✎]",
	defaultPersona: "★",
	delete: "✕",
	success: "✔︎",
	failure: "✗",
	pending: "…",
	checkboxOn: "[x]",
	checkboxOff: "[ ]",
} as const;

export const STATUS_GLYPHS = {
	success: { glyph: UI_GLYPHS.success, color: "green" },
	error: { glyph: UI_GLYPHS.failure, color: "red" },
	pending: { glyph: UI_GLYPHS.pending, color: "yellow" },
	running: { glyph: UI_GLYPHS.pending, color: "yellow" },
	enabled: { glyph: UI_GLYPHS.success, color: "green" },
	disabled: { glyph: UI_GLYPHS.failure, color: "red" },
} as const;

export const PLAN_STATUS_GLYPHS = {
	pending: { glyph: "○", color: "gray" },
	in_progress: { glyph: "◉", color: "cyan" },
	completed: { glyph: UI_GLYPHS.success, color: "green" },
	skipped: { glyph: "–", color: "gray" },
	failed: { glyph: UI_GLYPHS.failure, color: "red" },
} as const;
