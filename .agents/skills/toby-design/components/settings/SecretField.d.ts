/**
 * A secret in a settings form (SettingsSecretFieldRow). Saved: "✓ Saved" + Change….
 * Not saved: a right-aligned secure field showing `placeholder`.
 */
export interface SecretFieldProps {
  label: string;
  /** A value is stored (the daemon returns the redacted marker). */
  saved?: boolean;
  /** Hint inside the empty field, e.g. "xoxb-…" or "Optional". */
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
}
export declare function SecretField(props: SecretFieldProps): JSX.Element;
