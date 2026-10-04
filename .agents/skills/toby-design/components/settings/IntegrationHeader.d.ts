/**
 * Top of an integration's settings page (IntegrationDetailHeader): icon tile,
 * name, plain status and the one action that matters now.
 */
export interface IntegrationHeaderProps {
  name: string;
  /** The integration's own icon; shown on a white tile. */
  iconSrc?: string;
  status?: 'connected' | 'disconnected' | 'attention' | 'checking';
  /** "Signed in with OAuth"; shown unless disconnected. */
  signedInWith?: string;
  /** Defaults to Connect (disconnected) or Re-authorize. */
  actionLabel?: string;
  onAction?: () => void;
  /** The plugin's own health details, shown under "Toby can't reach …". */
  issue?: string;
}
export declare function IntegrationHeader(props: IntegrationHeaderProps): JSX.Element;
