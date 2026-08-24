/**
 * One selectable row in the sidebar — chat session, integration, skill, memory.
 */
export interface SidebarRowProps {
  title: string;
  /** Second line, e.g. relative time or model name. */
  subtitle?: string;
  /** 16px leading icon or integration favicon. */
  glyph?: React.ReactNode;
  selected?: boolean;
  /** Trailing status affordance (awaiting-user bubble, count). */
  trailing?: React.ReactNode;
  onClick?: () => void;
}
export declare function SidebarRow(props: SidebarRowProps): JSX.Element;
