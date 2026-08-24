/**
 * Hairline accent progress bar — onboarding checklist completion.
 */
export interface ProgressBarProps {
  /** 0…1. */
  progress?: number;
  /** Track height in px; the app uses 3. */
  height?: number;
}
export declare function ProgressBar(props: ProgressBarProps): JSX.Element;
