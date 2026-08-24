/**
 * Compact Actions-rail row for a runner-only flow: title button, hover
 * description, spinner while running. Not a full dashboard card.
 */
export interface FlowRunnerCardProps {
  title: string;
  /** Flow description; shown on hover (native: SidebarActionHelpPopover). */
  description?: string;
  /** Optional leading glyph. Native uses play.circle. */
  stamp?: React.ReactNode;
  running?: boolean;
  /** Error text from the last run, shown under the row. */
  error?: string;
  onRun?: () => void;
}
export declare function FlowRunnerCard(props: FlowRunnerCardProps): JSX.Element;
