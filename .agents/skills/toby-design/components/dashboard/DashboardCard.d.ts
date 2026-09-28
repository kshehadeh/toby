/**
 * Home dashboard card (DashboardCard + CardHeader): content-background fill,
 * 1px separator stroke, 16px corners, 16px padding. Header: glyph, 14px
 * semibold title, "last ran" time, refresh and actions (…), then a divider.
 */
export interface DashboardCardProps {
  title: string;
  /** 14px header glyph in primary text. */
  glyph?: React.ReactNode;
  /** "Last ran" text, e.g. "9/18/26 07:08". */
  lastRan?: string;
  /** Replaces the default refresh + actions controls; pass null to hide them. */
  actions?: React.ReactNode;
  /** Spins the refresh glyph. */
  refreshing?: boolean;
  onRefresh?: () => void;
  onMenu?: () => void;
  /** Card body: summary text or CardSection blocks. */
  children?: React.ReactNode;
  /** Caps the card at 340px and overlays the fade + Show more bar. */
  showMore?: boolean;
  onShowMore?: () => void;
}
export declare function DashboardCard(props: DashboardCardProps): JSX.Element;

/**
 * One structured block in a dashboard card (DashboardStructuredSection).
 * Consecutive sections are split by a hairline.
 */
export interface CardSectionProps {
  /** 10px uppercase eyebrow, e.g. "Needs attention". */
  label?: string;
  /** 17px semibold title. */
  title?: string;
  /** 13px secondary body copy. */
  children?: React.ReactNode;
  /** Item rows: 13px medium title over an 11px secondary subtitle. */
  items?: { title: string; subtitle?: string }[];
}
export declare function CardSection(props: CardSectionProps): JSX.Element;
