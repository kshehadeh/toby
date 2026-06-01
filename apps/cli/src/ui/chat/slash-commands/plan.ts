import type { PlanPhase } from "../../../planning/types";
import type { SlashCommand, SlashCommandRuntime } from "./types";

function runPlanCommand(runtime: SlashCommandRuntime, subcommand?: string) {
	const plan = runtime.getActivePlan();
	if (!plan) {
		runtime.addMetaLine("No active plan in this session.");
		return;
	}

	if (!subcommand) {
		const lines = [`Plan: ${plan.goal}`, "Phases:"];
		for (const phase of plan.phases) {
			const glyph =
				phase.status === "completed"
					? "✓"
					: phase.status === "in_progress"
						? "◉"
						: phase.status === "skipped"
							? "–"
							: phase.status === "failed"
								? "✗"
								: "○";
			lines.push(`  ${glyph} ${phase.order + 1}. ${phase.label}`);
		}
		lines.push(`Status: ${plan.status}`);
		for (const line of lines) {
			runtime.addMetaLine(line);
		}
		return;
	}

	if (subcommand === "skip") {
		const current = plan.phases.find(
			(p: PlanPhase) => p.status === "in_progress",
		);
		if (!current) {
			runtime.addMetaLine("No phase currently in progress to skip.");
			return;
		}
		runtime.skipPlanPhase(plan.id, current.id);
		runtime.addMetaLine(`Skipped phase: ${current.label}`);
		return;
	}

	if (subcommand === "cancel") {
		runtime.cancelPlan(plan.id);
		runtime.addMetaLine("Plan cancelled. Returning to free-form chat.");
		return;
	}

	runtime.addMetaLine(
		`Unknown /plan subcommand: ${subcommand}. Use: /plan, /plan skip, /plan cancel`,
	);
}

export const planSlashCommand: SlashCommand = {
	command: "/plan",
	description: "Show or manage the active plan.",
	helpText: `/plan          Show the current plan and phase statuses
/plan skip     Skip the current in-progress phase
/plan cancel   Cancel the remaining plan and return to free-form chat`,
	run(runtime, rawArgs) {
		const subcommand = rawArgs?.trim().toLowerCase() || undefined;
		runPlanCommand(runtime, subcommand);
	},
};
