/**
 * @deprecated Not present in the current app (confirmed absent from
 * `apps/toby-app/Sources/TobyApp` as of the 2026-09-25 sync). Primary
 * navigation is now a plain sectioned `List` of monochrome `Label` rows;
 * see `Features/Sidebar/AppSidebar.swift`. Kept for historical reference only.
 */
export interface SidebarActionItem {
  id: string;
  title: string;
  /** 18px icon node. */
  glyph?: React.ReactNode;
  /** Per-destination hue — use the --toby-route-* tokens. */
  color?: string;
}
/**
 * The 3-column glyph grid of app destinations that used to sit at the bottom
 * of the sidebar.
 */
export interface SidebarActionGridProps {
  items?: SidebarActionItem[];
  selectedId?: string;
  onSelect?: (id: string) => void;
}
export declare function SidebarActionGrid(props: SidebarActionGridProps): JSX.Element;
