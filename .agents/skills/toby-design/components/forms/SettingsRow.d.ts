/**
 * Label + optional description on the left, control on the right, hairline divider below.
 */
export interface SettingsRowProps {
  title: string;
  description?: string;
  /** Set false on the last row in a card. */
  showsDivider?: boolean;
  /** The control (Toggle, Select, TextField, Button). */
  children?: React.ReactNode;
}
export declare function SettingsRow(props: SettingsRowProps): JSX.Element;
