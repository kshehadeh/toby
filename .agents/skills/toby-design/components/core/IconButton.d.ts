/**
 * Circular glyph-only button — attach, send, cancel, dismiss, refresh.
 */
export interface IconButtonProps {
  /** The icon node (an <svg> or <img>); sized to ~54% of the button. */
  glyph?: React.ReactNode;
  /** Accessible label; also the tooltip. */
  label: string;
  /** inverted = solid primary-text fill used by the enabled Send button. */
  tone?: 'muted' | 'faint' | 'accent' | 'inverted';
  size?: 'sm' | 'md' | 'lg';
  /** false renders a bare glyph with no circular fill (header controls). */
  filled?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}
export declare function IconButton(props: IconButtonProps): JSX.Element;
