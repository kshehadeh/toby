import { Text } from "ink";
import type { ReactElement } from "react";
import { formatMarkdownTable } from "./markdown-table";

export function MarkdownTableView(props: {
	readonly rows: readonly (readonly string[])[];
	readonly maxWidth: number;
	readonly dimColor?: boolean;
}): ReactElement {
	const formatted = formatMarkdownTable(props.rows, props.maxWidth);
	return (
		<>
			{formatted.map((row, idx) => {
				const isBorder =
					row.border === "top" ||
					row.border === "mid" ||
					row.border === "bottom";
				return (
					<Text
						key={`tbl-${idx}-${row.border}`}
						dimColor={props.dimColor ?? isBorder}
						bold={row.border === "header" && !props.dimColor}
						wrap="truncate-end"
					>
						{row.line.length > 0 ? row.line : " "}
					</Text>
				);
			})}
		</>
	);
}
