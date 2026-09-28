/**
 * Capsule push button (macOS 26): settings actions, card actions, dialogs.
 */
export interface ButtonProps {
  /** bordered = grey capsule; prominent = accent capsule; plain = accent text; destructive = red label on a grey capsule. */
  variant?: 'bordered' | 'prominent' | 'plain' | 'destructive';
  wide?: boolean;
  disabled?: boolean;
  /** Appends the ↗ affordance for links that leave the app. */
  external?: boolean;
  children?: React.ReactNode;
  onClick?: () => void;
}
export declare function Button(props: ButtonProps): JSX.Element;
