/**
 * One grouped-form row: 13px label left, control right, optional description under the label.
 */
export interface SettingsFormRowProps {
  label: string;
  description?: string;
  /** The control: Toggle, Select, Button, a right-aligned text input. */
  children?: React.ReactNode;
}
export declare function SettingsFormRow(props: SettingsFormRowProps): JSX.Element;
