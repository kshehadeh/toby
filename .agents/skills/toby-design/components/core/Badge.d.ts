/**
 * Small uppercase capsule label — "UP NEXT" on the up-next onboarding tile,
 * "UPDATING" next to the sidebar wordmark.
 */
export interface BadgeProps {
  tone?: 'neutral' | 'accent' | 'accentSoft';
  children?: React.ReactNode;
}
export declare function Badge(props: BadgeProps): JSX.Element;
