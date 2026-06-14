import { Box, Text } from "ink";
import type React from "react";
import { ViewModal } from "../../shared";
import { ACCENT } from "../constants";
import type { HelpKeyRow } from "../help-sections";
import type { UsageSections } from "../usage-sections";

const SECTION_BORDER = "gray";

type UsagePanelProps = {
	readonly termCols: number;
	readonly sections: UsageSections;
};

function UsageKeyValueRow({
	label,
	keys,
	width,
}: HelpKeyRow & { readonly width: number }) {
	const keysWidth = Math.min(28, Math.max(12, Math.floor(width * 0.42)));
	const labelWidth = Math.max(8, width - keysWidth - 1);

	return (
		<Box flexDirection="row" width={width}>
			<Box width={labelWidth}>
				<Text dimColor wrap="truncate-end">
					{label}
				</Text>
			</Box>
			<Box width={keysWidth} justifyContent="flex-end">
				<Text color={ACCENT} wrap="truncate-end">
					{keys}
				</Text>
			</Box>
		</Box>
	);
}

function UsageSectionBox({
	title,
	headerHint,
	width,
	children,
}: {
	readonly title: string;
	readonly headerHint?: string;
	readonly width: number;
	readonly children: React.ReactNode;
}) {
	return (
		<Box
			borderStyle="round"
			borderColor={SECTION_BORDER}
			flexDirection="column"
			paddingX={1}
			width={width}
		>
			<Box flexDirection="row" justifyContent="space-between" width="100%">
				<Text bold color={ACCENT} wrap="truncate-end">
					{title}
				</Text>
				{headerHint ? (
					<Text dimColor wrap="truncate-end">
						{headerHint}
					</Text>
				) : null}
			</Box>
			<Box marginTop={0} flexDirection="column">
				{children}
			</Box>
		</Box>
	);
}

function UsageKeySection({
	title,
	headerHint,
	rows,
	width,
}: {
	readonly title: string;
	readonly headerHint?: string;
	readonly rows: readonly HelpKeyRow[];
	readonly width: number;
}) {
	return (
		<UsageSectionBox title={title} headerHint={headerHint} width={width}>
			{rows.map((row) => (
				<UsageKeyValueRow
					key={`${title}-${row.label}`}
					label={row.label}
					keys={row.keys}
					width={Math.max(8, width - 2)}
				/>
			))}
		</UsageSectionBox>
	);
}

function UsageNotesSection({
	notes,
	width,
}: {
	readonly notes: readonly string[];
	readonly width: number;
}) {
	return (
		<UsageSectionBox title="Notes" width={width}>
			{notes.map((note) => (
				<Text key={note} dimColor wrap="wrap">
					{"· "}
					{note}
				</Text>
			))}
		</UsageSectionBox>
	);
}

export function UsagePanel({ termCols, sections }: UsagePanelProps) {
	const contentWidth = Math.max(24, termCols - 4);
	const twoColumn = contentWidth >= 72;
	const columnGap = 1;
	const columnWidth = twoColumn
		? Math.floor((contentWidth - columnGap) / 2)
		: contentWidth;

	return (
		<ViewModal termCols={termCols} borderColor={ACCENT}>
			<Box
				flexDirection={twoColumn ? "row" : "column"}
				gap={columnGap}
				width={contentWidth}
			>
				<Box flexDirection="column" gap={1} width={columnWidth}>
					<UsageKeySection
						title="Provider Plan"
						rows={sections.providerPlan}
						width={columnWidth}
					/>
					<UsageKeySection
						title="Active Session"
						rows={sections.activeSession}
						width={columnWidth}
					/>
				</Box>
				<Box flexDirection="column" gap={1} width={columnWidth}>
					<UsageKeySection
						title="Last Turn"
						headerHint="Most recent model call"
						rows={sections.lastTurn}
						width={columnWidth}
					/>
					<UsageNotesSection notes={sections.notes} width={columnWidth} />
				</Box>
			</Box>
			<Box marginTop={1} width={contentWidth}>
				<Text dimColor wrap="truncate-end">
					Esc or Enter to close
				</Text>
			</Box>
		</ViewModal>
	);
}
