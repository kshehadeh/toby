/**
 * Sidebar section: a 10px tertiary label in sentence case over its rows.
 */
export interface SidebarSectionProps {
  /** "Automation", "Tools". Omit for the untitled primary group. */
  title?: string;
  children?: React.ReactNode;
}
export declare function SidebarSection(props: SidebarSectionProps): JSX.Element;
