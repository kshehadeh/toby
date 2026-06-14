import { Box, Text } from "ink";
import type React from "react";
import { ViewModal } from "../../shared";
import { ACCENT } from "../constants";
import type {
	HelpKeyRow,
	HelpNumberedStep,
	HelpSections,
} from "../help-sections";

const SECTION_BORDER = "gray";

type HelpPanelProps = {
	readonly termCols: number;
	readonly sections: HelpSections;
};

function HelpKeyValueRow({
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

function HelpSectionBox({
	title,
	headerHint,
	titleColor,
	width,
	children,
}: {
	readonly title: string;
	readonly headerHint?: string;
	readonly titleColor?: string;
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
				<Text bold color={titleColor} wrap="truncate-end">
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

function HelpKeySection({
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
		<HelpSectionBox title={title} headerHint={headerHint} width={width}>
			{rows.map((row) => (
				<HelpKeyValueRow
					key={`${title}-${row.label}`}
					label={row.label}
					keys={row.keys}
					width={Math.max(8, width - 2)}
				/>
			))}
		</HelpSectionBox>
	);
}

function HelpGettingStartedSection({
	steps,
	width,
}: {
	readonly steps: readonly HelpNumberedStep[];
	readonly width: number;
}) {
	return (
		<HelpSectionBox
			title="Getting Started with Toby"
			titleColor={ACCENT}
			width={width}
		>
			{steps.map((step, index) => (
				<Box
					key={step.title}
					flexDirection="column"
					marginTop={index === 0 ? 0 : 1}
					width={Math.max(8, width - 2)}
				>
					<Text wrap="wrap">
						<Text bold color={ACCENT}>
							{index + 1}. {step.title}
						</Text>
					</Text>
					{step.body ? (
						<Text dimColor wrap="wrap">
							{step.body}
						</Text>
					) : null}
					{step.subItems?.map((item) => (
						<Text key={`${step.title}-${item}`} dimColor wrap="wrap">
							{"  · "}
							{item}
						</Text>
					))}
				</Box>
			))}
		</HelpSectionBox>
	);
}

function HelpTipsSection({
	tips,
	width,
}: {
	readonly tips: readonly string[];
	readonly width: number;
}) {
	return (
		<HelpSectionBox title="Tips" width={width}>
			{tips.map((tip) => (
				<Text key={tip} dimColor wrap="wrap">
					{"· "}
					{tip}
				</Text>
			))}
		</HelpSectionBox>
	);
}

export function HelpPanel({ termCols, sections }: HelpPanelProps) {
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
					<HelpKeySection
						title="Basics"
						rows={sections.basics}
						width={columnWidth}
					/>
					<HelpKeySection
						title="Shortcuts"
						rows={sections.shortcuts}
						width={columnWidth}
					/>
					<HelpKeySection
						title="Navigation"
						rows={sections.navigation}
						width={columnWidth}
					/>
				</Box>
				<Box flexDirection="column" gap={1} width={columnWidth}>
					<HelpGettingStartedSection
						steps={sections.gettingStarted}
						width={columnWidth}
					/>
					<HelpKeySection
						title="Common Commands"
						headerHint="Type / for all"
						rows={sections.commonCommands}
						width={columnWidth}
					/>
					<HelpTipsSection tips={sections.tips} width={columnWidth} />
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
