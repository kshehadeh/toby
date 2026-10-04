/**
 * A System Settings section (grouped Form `Section`): 13px semibold title,
 * rows on one rounded fill with inset hairlines, optional footer sentence.
 */
export interface SettingsGroupProps {
  title?: React.ReactNode;
  /** One sentence under the box: where a value comes from, what a toggle does. */
  footer?: React.ReactNode;
  /** SettingsFormRow, SecretField, MethodPicker or any 40px row. */
  children?: React.ReactNode;
}
export declare function SettingsGroup(props: SettingsGroupProps): JSX.Element;
