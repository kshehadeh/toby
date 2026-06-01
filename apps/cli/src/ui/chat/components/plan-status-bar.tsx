import type { Plan, PlanPhaseStatus } from "@toby/core/planning/types";
import { Box, Text } from "ink";
import React from "react";
import { PLAN_STATUS_GLYPHS } from "../../shared";
import { ACCENT } from "../constants";

interface PlanStatusBarProps {
	readonly plan: Plan;
	readonly termCols: number;
}

function combineStatuses(
	statuses: readonly PlanPhaseStatus[],
): PlanPhaseStatus {
	if (statuses.includes("in_progress")) return "in_progress";
	if (statuses.includes("failed")) return "failed";
	if (statuses.length > 0 && statuses.every((s) => s === "completed")) {
		return "completed";
	}
	if (statuses.length > 0 && statuses.every((s) => s === "skipped")) {
		return "skipped";
	}
	if (statuses.includes("completed")) return "in_progress";
	if (statuses.includes("skipped")) return "in_progress";
	return "pending";
}

function groupPlanPhases(plan: Plan): {
	readonly id: string;
	readonly label: string;
	readonly status: PlanPhaseStatus;
	readonly count: number;
}[] {
	const groups: {
		id: string;
		label: string;
		statuses: PlanPhaseStatus[];
		count: number;
	}[] = [];
	for (const phase of plan.phases) {
		const existing = groups.find((group) => group.label === phase.label);
		if (existing) {
			existing.statuses.push(phase.status);
			existing.count += 1;
			continue;
		}
		groups.push({
			id: phase.id,
			label: phase.label,
			statuses: [phase.status],
			count: 1,
		});
	}
	return groups.map((group) => ({
		id: group.id,
		label: group.label,
		status: combineStatuses(group.statuses),
		count: group.count,
	}));
}

export function PlanStatusBar({ plan, termCols }: PlanStatusBarProps) {
	if (plan.status === "completed" || plan.status === "failed") {
		return null;
	}

	const goalTruncated =
		plan.goal.length > 40 ? `${plan.goal.slice(0, 37)}…` : plan.goal;
	const innerWidth = Math.max(12, termCols - 4);

	return (
		<Box
			flexShrink={0}
			flexDirection="column"
			borderStyle="round"
			borderColor={ACCENT}
			paddingX={1}
			width={termCols}
		>
			<Box width={innerWidth}>
				<Text bold color={ACCENT} wrap="truncate-end">
					Plan: "{goalTruncated}"
				</Text>
			</Box>
			<Box flexDirection="row" flexWrap="wrap" gap={1} width={innerWidth}>
				{groupPlanPhases(plan).map((phase, i) => {
					const { glyph, color } = PLAN_STATUS_GLYPHS[phase.status];
					const label =
						phase.label.length > 20
							? `${phase.label.slice(0, 17)}…`
							: phase.label;
					return (
						<Text key={phase.id} color={color} wrap="truncate-end">
							{glyph} {i + 1}.{label}
							{phase.count > 1 ? ` (x${phase.count})` : ""}
						</Text>
					);
				})}
			</Box>
		</Box>
	);
}
