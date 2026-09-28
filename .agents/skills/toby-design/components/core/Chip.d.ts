/**
 * Attachment chip (AttachmentChip): selection-filled capsule, 10px text.
 */
export interface ChipProps {
  /** Small leading glyph (paperclip in the app). */
  leading?: React.ReactNode;
  label: string;
  /** Trailing faint detail, e.g. "24 KB". */
  meta?: string;
  /** Renders the ✕ affordance when provided. */
  onRemove?: () => void;
}
export declare function Chip(props: ChipProps): JSX.Element;
