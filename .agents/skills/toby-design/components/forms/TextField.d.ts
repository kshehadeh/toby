/**
 * Inline rounded-border text field for settings rows and credential fields.
 */
export interface TextFieldProps {
  value?: string;
  placeholder?: string;
  /** Renders a masked field (API keys, tokens). */
  secure?: boolean;
  minWidth?: number;
  maxWidth?: number;
  onChange?: (value: string) => void;
}
export declare function TextField(props: TextFieldProps): JSX.Element;
