/**
 * Pulsing placeholder lines shown while an AI summary is generating.
 */
export interface SkeletonProps {
  /** Number of bars; the app uses 4. */
  lines?: number;
  /** Bar height in px; the app uses 12. */
  height?: number;
}
export declare function Skeleton(props: SkeletonProps): JSX.Element;
