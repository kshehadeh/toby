/**
 * Chat composer (InputDock): one Liquid Glass slab with the text field on
 * top and a control row: attach (leading), context gauge, stop, send.
 */
export interface InputDockProps {
  value?: string;
  /** Defaults to the key hint, "Return to send · Shift+Return for newline". */
  placeholder?: string;
  /** 0–100; draws the ring gauge (accent from 80%). */
  contextPercent?: number;
  /** Shows the slash-circle "no context info" glyph instead of the gauge. */
  contextUnavailable?: boolean;
  /** Chip row above the field. */
  attachments?: React.ReactNode;
  /** Disables the field and shows the stop button. */
  loading?: boolean;
  canAttach?: boolean;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  onAttach?: () => void;
}
export declare function InputDock(props: InputDockProps): JSX.Element;
