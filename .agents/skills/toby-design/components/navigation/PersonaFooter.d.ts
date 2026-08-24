/**
 * Sidebar footer: persona portrait, persona name, active model, and the
 * up/down chevron that opens the persona picker.
 */
export interface PersonaFooterProps {
  name?: string;
  /** Provider/model slug shown beneath the name. */
  model?: string;
  /** Persona portrait — see assets/personas/. */
  imageSrc?: string;
  /** True while the picker popover is open (keeps the row filled). */
  open?: boolean;
  onClick?: () => void;
}
export declare function PersonaFooter(props: PersonaFooterProps): JSX.Element;
