/**
 * macOS switch. On-state is the fixed system green (--control-toggle-on),
 * NOT the user's accent color.
 */
export interface ToggleProps {
  checked?: boolean;
  disabled?: boolean;
  /** Accessible label; visible labels are hidden in Toby's forms. */
  label?: string;
  onChange?: (next: boolean) => void;
}
export declare function Toggle(props: ToggleProps): JSX.Element;
