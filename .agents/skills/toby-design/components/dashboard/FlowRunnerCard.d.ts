/**
 * Compact dashboard card for a runner-only flow: description plus a single
 * full-width Run Now action. Shares the block card's shell so edges align.
 */
export interface FlowRunnerCardProps {
  title: string;
  /** Flow description from the block descriptor; falls back to "Run this flow." */
  description?: string;
  /** The ghost glyph — a ~120px icon node. */
  stamp?: React.ReactNode;
  running?: boolean;
  /** Error text from the last run, shown under the description. */
  error?: string;
  onRun?: () => void;
}
export declare function FlowRunnerCard(props: FlowRunnerCardProps): JSX.Element;
