/** Default SF Symbol used for custom flows that do not choose an icon. */
export const DEFAULT_CUSTOM_FLOW_ICON = "arrow.triangle.branch";

/**
 * SF Symbols offered by Toby's custom-flow editor.
 *
 * Keep this list in sync with `FlowIconOption.all` in Toby.app.
 */
export const FLOW_ICON_SYMBOLS = [
	DEFAULT_CUSTOM_FLOW_ICON,
	"bolt.fill",
	"sparkles",
	"wand.and.stars",
	"play.circle",
	"gearshape",
	"clock",
	"calendar",
	"checklist",
	"envelope",
	"tray",
	"paperplane",
	"bell",
	"flag",
	"bookmark",
	"star",
	"heart",
	"house",
	"briefcase",
	"folder",
	"doc.text",
	"person",
	"bubble.left",
	"link",
	"globe",
	"laptopcomputer",
	"moon",
	"sun.max",
	"flame",
	"leaf",
	"cart",
	"bag",
	"hammer",
	"wrench.and.screwdriver",
] as const;

export type FlowIconSymbol = (typeof FLOW_ICON_SYMBOLS)[number];

const FLOW_ICON_SYMBOL_SET = new Set<string>(FLOW_ICON_SYMBOLS);

export function isFlowIconSymbol(value: string): value is FlowIconSymbol {
	return FLOW_ICON_SYMBOL_SET.has(value);
}
