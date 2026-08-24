/**
 * Filled + outlined inline callout for form feedback and health details.
 */
export interface InlineStatusMessageProps {
  tone?: 'success' | 'error';
  message: string;
  /** Override the default ✓ / ! mark with an icon node. */
  glyph?: React.ReactNode;
}
export declare function InlineStatusMessage(props: InlineStatusMessageProps): JSX.Element;
