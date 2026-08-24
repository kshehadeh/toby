/**
 * Assistant turn: persona rail on the left, serif long-form answer on the right.
 */
export interface AssistantMessageProps {
  /** Small semibold label above the answer — usually the persona name. */
  header?: string;
  /** Persona portrait for the rail. */
  avatarSrc?: string;
  /** The answer body — prose, lists, tables. */
  children?: React.ReactNode;
  /** Copy-response control. */
  footer?: React.ReactNode;
}
export declare function AssistantMessage(props: AssistantMessageProps): JSX.Element;
