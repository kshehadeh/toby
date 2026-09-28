/**
 * Tool-activity group (WorkedForRow): a 13px secondary "Worked for 4s" line
 * with a disclosure chevron; expanded, one row per step.
 */
export interface WorkStep {
  /** Tool glyph, tinted in the markdown-heading blue. */
  glyph?: React.ReactNode;
  title: string;
  /** One-line detail under the title. */
  detail?: string;
  /** Render the detail in the monospaced face (file paths). */
  path?: boolean;
  /** Shown as "×3" when above 1; otherwise duration shows. */
  count?: number;
  duration?: string;
  /** Marks the failing step: red glyph and error text. */
  failing?: boolean;
  error?: string;
}
export interface WorkStepRowProps {
  /** "Worked for 4s", "Working… 3s", "Stopped after 2s". */
  label?: string;
  /** Adds the pulsing accent dot. */
  running?: boolean;
  failed?: boolean;
  expanded?: boolean;
  steps?: WorkStep[];
  onToggle?: () => void;
}
export declare function WorkStepRow(props: WorkStepRowProps): JSX.Element;
