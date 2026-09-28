/**
 * Sidebar footer (SidebarFooter): the persona picker button and the server
 * status dot.
 */
export interface PersonaFooterProps {
  name?: string;
  /** 24px portrait with 4px corners. */
  imageSrc?: string;
  /** Server status dot color: green / accent / red / faint. */
  status?: 'connected' | 'connecting' | 'error' | 'idle';
  /** Picker open: 14% accent fill. */
  open?: boolean;
  /** Asking for attention: 16% accent fill, accent stroke, pulse. */
  attention?: boolean;
  onClick?: () => void;
}
export declare function PersonaFooter(props: PersonaFooterProps): JSX.Element;
