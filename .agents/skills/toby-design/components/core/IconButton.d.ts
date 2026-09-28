/**
 * Circular glyph-only button (.buttonBorderShape(.circle)).
 */
export interface IconButtonProps {
  glyph?: React.ReactNode;
  /** Accessible label; also the tooltip. */
  label: string;
  /** muted = grey circle; prominent = accent circle, white glyph (Send); accent = accent wash; faint = quiet glyph. `inverted` is accepted as an alias of prominent. */
  tone?: 'muted' | 'faint' | 'accent' | 'prominent' | 'inverted';
  /** 22 / 28 / 34px. */
  size?: 'sm' | 'md' | 'lg';
  /** false renders a bare glyph with no fill. */
  filled?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}
export declare function IconButton(props: IconButtonProps): JSX.Element;
