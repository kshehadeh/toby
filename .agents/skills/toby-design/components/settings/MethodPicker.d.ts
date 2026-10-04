/**
 * "Sign in › Method": segmented control over an integration's auth methods.
 * Labels lose "(recommended)".
 */
export interface MethodPickerProps {
  options: { value: string; label: string }[];
  value: string;
  onChange?: (value: string) => void;
  label?: string;
}
export declare function MethodPicker(props: MethodPickerProps): JSX.Element;
