export interface SidebarActionItem {
  id: string;
  title: string;
  /** 18px icon node. */
  glyph?: React.ReactNode;
  /** Per-destination hue — use the --toby-route-* tokens. */
  color?: string;
}
/**
 * The 3-column glyph grid of app destinations at the bottom of the sidebar.
 */
export interface SidebarActionGridProps {
  items?: SidebarActionItem[];
  selectedId?: string;
  onSelect?: (id: string) => void;
}
export declare function SidebarActionGrid(props: SidebarActionGridProps): JSX.Element;
