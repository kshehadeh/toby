/** Default tile color for custom flows that do not choose one. */
export const DEFAULT_FLOW_TILE_COLOR = "teal";

/**
 * Named fills offered by Toby's custom-flow editor for Home Actions tiles.
 *
 * Keep this list in sync with `FlowColorOption.all` in Toby.app.
 * Values match the app accent presets so tiles stay on the product palette.
 */
export const FLOW_TILE_COLORS = [
	DEFAULT_FLOW_TILE_COLOR,
	"blue",
	"green",
	"orange",
	"purple",
	"pink",
	"red",
	"gray",
] as const;

export type FlowTileColor = (typeof FLOW_TILE_COLORS)[number];

const FLOW_TILE_COLOR_SET = new Set<string>(FLOW_TILE_COLORS);

export function isFlowTileColor(value: string): value is FlowTileColor {
	return FLOW_TILE_COLOR_SET.has(value);
}
