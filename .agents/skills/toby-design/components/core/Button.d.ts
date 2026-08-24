/**
 * Text button used across settings rows, dashboard cards, and dialogs.
 */
export interface ButtonProps {
  /** bordered = default macOS bordered control; prominent = accent-filled; plain = accent text; destructive = red label. */
  variant?: 'bordered' | 'prominent' | 'plain' | 'destructive';
  /** Fill the container width (used for "Run Now" in flow cards). */
  wide?: boolean;
  disabled?: boolean;
  /** Appends the ↗ affordance used for links that leave the app. */
  external?: boolean;
  children?: React.ReactNode;
  onClick?: () => void;
}
export declare function Button(props: ButtonProps): JSX.Element;
