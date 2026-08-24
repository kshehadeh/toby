/**
 * One step in the "Finish setting up Toby" checklist grid.
 */
export interface OnboardingTileProps {
  title: string;
  subtitle?: string;
  /** Step icon (~15px). */
  glyph?: React.ReactNode;
  /** CTA label, e.g. "Connect email". */
  actionLabel?: string;
  /** The single highlighted next step — accent wash, accent border, badge, filled CTA. */
  upNext?: boolean;
  complete?: boolean;
  onAction?: () => void;
}
export declare function OnboardingTile(props: OnboardingTileProps): JSX.Element;
