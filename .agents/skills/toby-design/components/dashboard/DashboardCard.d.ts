/**
 * Home dashboard block. A flat panel with a 2px accent cap rule, an oversized
 * flat "ghost" glyph at 4.5% opacity in the lower-right corner, no border and
 * no divider. Summary copy is set in the serif face so anything Toby wrote
 * reads in Toby's voice wherever it appears.
 */
export interface DashboardCardProps {
  title: string;
  /** The ghost glyph — pass a ~120px icon node. Flat, unrotated, unshadowed. */
  stamp?: React.ReactNode;
  /** "Last ran" text, e.g. "07:15". */
  lastRan?: string;
  /** Header trailing controls — refresh + actions menu. */
  actions?: React.ReactNode;
  /** Card body — usually a series of CardSection blocks. */
  children?: React.ReactNode;
  /** Renders the gradient fade + Show more control over the lower edge. */
  showMore?: boolean;
}
export declare function DashboardCard(props: DashboardCardProps): JSX.Element;

/**
 * One labelled block inside a dashboard card body: a small uppercase caption
 * over serif prose.
 */
export interface CardSectionProps {
  /** e.g. "Needs attention", "Overdue", "Today". */
  label?: string;
  children?: React.ReactNode;
}
export declare function CardSection(props: CardSectionProps): JSX.Element;
