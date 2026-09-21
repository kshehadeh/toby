/**
 * Compact Actions-rail tile for a runner-only flow: colored Shortcuts-style
 * card, flow icon, play glyph, hover popover (title + description), spinner
 * while running. Not a full dashboard card.
 */
export interface FlowRunnerCardProps {
  title: string;
  /** Flow description; shown on hover (native: SidebarActionHelpPopover). */
  description?: string;
  /** Optional leading glyph. Native uses the flow SF Symbol. */
  stamp?: React.ReactNode;
  /** Named tile fill from the flow editor (`FLOW_TILE_COLORS`). */
  color?: string;
  running?: boolean;
  /** Error text from the last run, shown under the row. */
  error?: string;
  onRun?: () => void;
}
export declare function FlowRunnerCard(props: FlowRunnerCardProps): JSX.Element;
