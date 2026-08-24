export interface SelectChoice { value: string; label: string; }
/**
 * Pop-up menu picker (SwiftUI .menu style) for settings rows.
 */
export interface SelectProps {
  value?: string;
  options?: SelectChoice[];
  minWidth?: number;
  /** 320 by default — wide enough for gateway model slugs. */
  maxWidth?: number;
  onChange?: (value: string) => void;
}
export declare function Select(props: SelectProps): JSX.Element;
