/**
 * Right-aligned prompt bubble with a 4px accent bar down its leading edge.
 */
export interface UserMessageProps {
  text: string;
  /** Copy / show-more affordances beneath the bubble. */
  footer?: React.ReactNode;
}
export declare function UserMessage(props: UserMessageProps): JSX.Element;
