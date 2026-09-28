/**
 * User turn (UserMessageRow): a left-aligned bubble in the 720px reading
 * column, elevated fill at 92%, hairline stroke, 14px corners, SF Pro 15.
 */
export interface UserMessageProps {
  text: string;
  /** Compact relative time shown trailing under the bubble. */
  timestamp?: string;
  /** Replaces the default copy + timestamp row; pass null to hide it. */
  footer?: React.ReactNode;
  onCopy?: () => void;
}
export declare function UserMessage(props: UserMessageProps): JSX.Element;
