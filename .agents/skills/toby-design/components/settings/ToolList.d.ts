/**
 * "What Toby can do in …": tools with an action icon, first-sentence
 * description and a "Makes changes" tag on tools that write.
 */
export interface ToolListProps {
  integration: string;
  tools: { name: string; description?: string; icon?: React.ReactNode; writes?: boolean }[];
  /** Rows shown before "Show all N tools". */
  collapsedCount?: number;
}
export declare function ToolList(props: ToolListProps): JSX.Element;
