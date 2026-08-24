/**
 * The chat composer — floating rounded dock with keyboard hints, attach,
 * context-fill gauge and send.
 */
export interface InputDockProps {
  value?: string;
  /** Default: "Ask Toby to handle something". */
  placeholder?: string;
  /** Show the "Return to send / Shift+Return for newline" hints. */
  hint?: boolean;
  /** 0–100; renders the ring gauge. Omit when the provider doesn't report it. */
  contextPercent?: number;
  /** Attachment chips row rendered above the field. */
  attachments?: React.ReactNode;
  loading?: boolean;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
}
export declare function InputDock(props: InputDockProps): JSX.Element;
