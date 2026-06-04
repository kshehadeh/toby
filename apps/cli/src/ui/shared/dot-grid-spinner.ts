/** Single-cell braille dot-grid cycle (2×2 dots lighting in sequence). */
export const DOT_GRID_SPINNER_FRAMES = [
	"⣾",
	"⣷",
	"⣯",
	"⣟",
	"⡿",
	"⢿",
	"⣽",
	"⣻",
] as const;

export const DOT_GRID_SPINNER_INTERVAL_MS = 80;

export function dotGridSpinnerFrame(frame: number): string {
	return DOT_GRID_SPINNER_FRAMES[frame % DOT_GRID_SPINNER_FRAMES.length] ?? "⣾";
}
