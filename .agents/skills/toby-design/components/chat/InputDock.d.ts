/**
 * The chat composer — floating rounded dock with attach on the left, send on
 * the right, and keyboard-shortcut placeholder copy.
 */
export interface InputDockProps {
  value?: string;
  /** Default: "Return to send · Shift+Return for newline". */
  placeholder?: string;
  /** 0–100; renders the ring gauge. Omit when the provider doesn't report it. */
  contextPercent?: number;
  /** Attachment chips row rendered above the field. */
  attachments?: React.ReactNode;
  loading?: boolean;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
}
export declare function InputDock(props: InputDockProps): JSX.Element;
