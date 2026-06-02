import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { ScheduleRun } from "../../schedules/types";
import { ACCENT } from "../chat/constants";
import {
	SectionDivider,
	StatusIcon,
	ViewFrame,
	isNavigateDown,
	isNavigateUp,
} from "../shared";

export function ScheduleRunOutputView({
	run,
	scheduleName,
	onBack,
}: {
	readonly run: ScheduleRun;
	readonly scheduleName: string;
	readonly onBack: () => void;
}) {
	const [scrollOffset, setScrollOffset] = useState(0);

	const rawOutput = run.output ?? "(no output)";
	const lines = rawOutput.split("\n");
	const totalLines = lines.length;

	// Keep this simple: a reasonable default viewport that works without
	// needing terminal measurement APIs from the old schedules app.
	const visibleLines = 18;
	const maxOffset = Math.max(0, totalLines - visibleLines);
	const visible = lines.slice(scrollOffset, scrollOffset + visibleLines);

	useInput((input, key) => {
		if (key.escape) {
			onBack();
			return;
		}
		if (isNavigateDown(input, key)) {
			setScrollOffset((o) => Math.min(o + 1, maxOffset));
			return;
		}
		if (isNavigateUp(input, key)) {
			setScrollOffset((o) => Math.max(o - 1, 0));
		}
	});

	const scrollIndicator =
		totalLines > visibleLines
			? ` [${scrollOffset + 1}-${Math.min(
					scrollOffset + visibleLines,
					totalLines,
				)}/${totalLines}]`
			: "";

	return (
		<ViewFrame
			title={`Schedules > ${scheduleName} > Run ${new Date(run.startedAt).toLocaleString()}`}
			footer={<Text dimColor>↑↓ scroll · Esc back</Text>}
		>
			<Box paddingX={1} flexDirection="column">
				<Text>
					<StatusIcon status={run.status} />
					<Text dimColor>
						{" "}
						{run.status.toUpperCase()} ·{" "}
						{new Date(run.startedAt).toLocaleString()}
						{run.completedAt
							? ` → ${new Date(run.completedAt).toLocaleString()}`
							: ""}
					</Text>
				</Text>
				{run.error ? <Text color="red">{run.error}</Text> : null}
			</Box>
			<SectionDivider label={`Output${scrollIndicator}`} />
			<Box paddingX={1} flexDirection="column">
				{visible.map((line, i) => (
					<Text key={`line-${run.id}-${scrollOffset + i}`}>{line}</Text>
				))}
				{visible.length === 0 ? (
					<Text dimColor>
						<Text color={ACCENT}>No output</Text>
					</Text>
				) : null}
			</Box>
		</ViewFrame>
	);
}
