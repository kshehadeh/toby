/**
 * Home Actions tile for a runner-only flow (DashboardActionRunnersRail): a
 * Shortcuts-style colored card, 68px tall, 16px corners.
 */
export interface FlowRunnerCardProps {
  title: string;
  /** 15px white glyph, top-left. */
  glyph?: React.ReactNode;
  /** The flow's color preset; defaults to var(--toby-accent-teal). */
  color?: string;
  /** Shown as the hover help. */
  description?: string;
  /** Swaps the glyph for a spinner and pulses the fill. */
  running?: boolean;
  /** Error text from the last run, shown under the tile. */
  error?: string;
  onRun?: () => void;
}
export declare function FlowRunnerCard(props: FlowRunnerCardProps): JSX.Element;
