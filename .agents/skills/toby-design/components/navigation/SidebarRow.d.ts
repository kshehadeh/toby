/**
 * Sidebar and list-column row. variant="browser" is FeatureBrowserRow, the
 * row of every list/detail column; variant="destination" is a primary
 * sidebar destination (Home, Chats, Projects, …).
 */
export interface SidebarRowProps {
  variant?: 'browser' | 'destination';
  title: string;
  /** Browser rows only: 10px tertiary second line. */
  subtitle?: string;
  /** Browser rows only: small capsule after the title, e.g. "Built-in". */
  badge?: string;
  glyph?: React.ReactNode;
  selected?: boolean;
  /** Browser rows only: false when the host draws its own selection. */
  drawsSelectionFill?: boolean;
  trailing?: React.ReactNode;
  onClick?: () => void;
}
export declare function SidebarRow(props: SidebarRowProps): JSX.Element;
