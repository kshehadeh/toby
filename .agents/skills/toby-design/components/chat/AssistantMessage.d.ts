/**
 * Assistant turn (AssistantMessageRow): SF Pro 15px answer with 6pt extra
 * leading, left-aligned in the 720px reading column. No avatar, no label.
 */
export interface AssistantMessageProps {
  /** The answer body: prose, lists, tables. */
  children?: React.ReactNode;
  /** Compact relative time shown trailing in the actions row, e.g. "2m ago". */
  timestamp?: string;
  /** While streaming, the copy/timestamp row is hidden. */
  streaming?: boolean;
  /** Replaces the default copy + timestamp row; pass null to hide it. */
  footer?: React.ReactNode;
  onCopy?: () => void;
}
export declare function AssistantMessage(props: AssistantMessageProps): JSX.Element;
