/**
 * Detail-pane metadata grid (DetailMetadataStack + DetailMetadataRow):
 * 12px labels beside 12px values, both leading-aligned.
 */
export interface DetailMetadataProps {
  rows: { label: string; value: string; mono?: boolean }[];
}
export declare function DetailMetadata(props: DetailMetadataProps): JSX.Element;
