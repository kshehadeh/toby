/**
 * One line of pipeline chrome in the transcript — a tool call, plan, or
 * lifecycle step, with duration and expandable output.
 */
export interface WorkStepRowProps {
  /** Rendered uppercase and tracked-out so it recedes behind the answer. */
  title: string;
  body?: string;
  /** Preformatted duration, e.g. "1.4s". */
  duration?: string;
  /** Aggregated repeat count; renders "×3" when > 1. */
  count?: number;
  /** Tool icon; falls back to a 7px accent dot. */
  glyph?: React.ReactNode;
  /** Step still running (spinner state). */
  active?: boolean;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}
export declare function WorkStepRow(props: WorkStepRowProps): JSX.Element;
