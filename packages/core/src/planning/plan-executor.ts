import type { CoreMessage } from "../ai/chat";
import type { ChatEvent, ChatEventSink } from "../chat-pipeline/chat-events";
import {
	addPhase,
	loadPlan,
	updatePhaseStatus,
	updatePlanStatus,
} from "./plan-store";
import type { Plan, PlanPhaseStatus, PlanStatus } from "./types";

type TurnRunner = (
	messages: CoreMessage[],
	overrideSessionId?: string,
) => Promise<{
	text: string;
	responseMessages: CoreMessage[];
	usage?: unknown;
}>;
type PlanExecutorOptions = {
	readonly sessionId: string;
	readonly emitChatEvent: ChatEventSink;
	readonly nextSeq: () => number;
	readonly runTurn: TurnRunner;
	readonly abortSignal?: AbortSignal;
};

type PhaseResult = {
	readonly phaseId: string;
	readonly status: PlanPhaseStatus;
	readonly assistantText: string;
	readonly amendment?: {
		readonly label: string;
		readonly description: string;
		readonly afterOrder: number;
	};
};

/**
 * Build a user message that instructs the model to execute a specific plan phase.
 */
function buildPhaseUserMessage(
	phase: { label: string; description: string },
	index: number,
	total: number,
	remainingPhases: readonly { label: string; description: string }[],
): string {
	const remainingText =
		remainingPhases.length > 0
			? `Remaining phases after this one:\n${remainingPhases.map((p, i) => `  ${index + 1 + i + 1}. ${p.label}: ${p.description}`).join("\n")}`
			: "This is the final phase.";

	return `[Plan phase ${index + 1}/${total}: "${phase.label}"]
Instructions: ${phase.description}

${remainingText}

When done with this phase, briefly confirm completion. If the plan needs adjustment (add/remove/reorder phases), say "PLAN AMENDMENT:" followed by a description of what changed.`;
}

/**
 * Try to extract a plan amendment from the assistant text.
 * Returns undefined if no amendment was detected.
 */
function extractAmendment(
	assistantText: string,
): PhaseResult["amendment"] | undefined {
	const match = assistantText.match(
		/PLAN AMENDMENT:\s*Add phase[:\s]+(.*?)[:\s—–-]+(.*?)(?:\n|$)/i,
	);
	if (match?.[1] && match[2]) {
		return {
			label: match[1].trim().slice(0, 60),
			description: match[2].trim(),
			afterOrder: -1,
		};
	}
	return undefined;
}

/**
 * Determine the phase status from the assistant text.
 * If the assistant confirms completion, mark as completed.
 * If there's an error-like pattern, mark as failed.
 * Otherwise mark as completed (the model ran the turn).
 */
function inferPhaseStatus(assistantText: string): PlanPhaseStatus {
	const lower = assistantText.toLowerCase();
	if (
		lower.includes("i was unable to") ||
		lower.includes("this failed") ||
		lower.includes("could not complete")
	) {
		return "failed";
	}
	return "completed";
}

/**
 * UI-agnostic plan executor: iterates phases, injects phase context into
 * user messages, calls the turn runner, and updates plan state.
 */
export async function executePlan(
	plan: Plan,
	options: PlanExecutorOptions,
): Promise<Plan> {
	const { sessionId, emitChatEvent, nextSeq, runTurn, abortSignal } = options;

	let currentPlan = loadPlan(plan.id) ?? plan;
	updatePlanStatus(currentPlan.id, "in_progress");
	currentPlan = { ...currentPlan, status: "in_progress" };

	emitChatEvent({
		type: "plan_created",
		id: currentPlan.id,
		seq: nextSeq(),
		goal: currentPlan.goal,
		phaseCount: currentPlan.phases.length,
	});

	let messages: CoreMessage[] = [];

	for (let i = 0; i < currentPlan.phases.length; i++) {
		if (abortSignal?.aborted) {
			updatePlanStatus(currentPlan.id, "interrupted");
			emitChatEvent({
				type: "plan_completed",
				planId: currentPlan.id,
				seq: nextSeq(),
				status: "interrupted",
			});
			return loadPlan(currentPlan.id) ?? currentPlan;
		}

		const phase = currentPlan.phases[i];
		if (!phase) continue;
		if (phase.status === "completed" || phase.status === "skipped") continue;

		// Mark phase as in progress
		updatePhaseStatus(phase.id, "in_progress");
		currentPlan = loadPlan(currentPlan.id) ?? currentPlan;

		emitChatEvent({
			type: "plan_phase_start",
			planId: currentPlan.id,
			phaseId: phase.id,
			seq: nextSeq(),
			label: phase.label,
			index: i,
			total: currentPlan.phases.length,
		});

		const remaining = currentPlan.phases.slice(i + 1);
		const phaseMsg = buildPhaseUserMessage(
			phase,
			i,
			currentPlan.phases.length,
			remaining,
		);

		const userMsg: CoreMessage = { role: "user", content: phaseMsg };
		const allMessages = [...messages, userMsg];

		try {
			const turnResult = await runTurn(allMessages, sessionId);
			messages = [...messages, userMsg, ...turnResult.responseMessages];

			const phaseStatus = inferPhaseStatus(turnResult.text);
			updatePhaseStatus(phase.id, phaseStatus);

			const amendment = extractAmendment(turnResult.text);
			if (amendment) {
				const newPhase = addPhase(
					currentPlan.id,
					amendment.label,
					amendment.description,
					i,
				);
				emitChatEvent({
					type: "plan_amended",
					planId: currentPlan.id,
					seq: nextSeq(),
					detail: `Added phase "${newPhase.label}" after phase ${i + 1}`,
				});
				currentPlan = loadPlan(currentPlan.id) ?? currentPlan;
			}

			emitChatEvent({
				type: "plan_phase_end",
				planId: currentPlan.id,
				phaseId: phase.id,
				seq: nextSeq(),
				status: phaseStatus,
			});

			if (phaseStatus === "failed") {
				updatePlanStatus(currentPlan.id, "failed");
				emitChatEvent({
					type: "plan_completed",
					planId: currentPlan.id,
					seq: nextSeq(),
					status: "failed",
				});
				return loadPlan(currentPlan.id) ?? currentPlan;
			}

			currentPlan = loadPlan(currentPlan.id) ?? currentPlan;
		} catch (e) {
			updatePhaseStatus(phase.id, "failed");
			updatePlanStatus(currentPlan.id, "failed");
			emitChatEvent({
				type: "plan_phase_end",
				planId: currentPlan.id,
				phaseId: phase.id,
				seq: nextSeq(),
				status: "failed",
			});
			emitChatEvent({
				type: "plan_completed",
				planId: currentPlan.id,
				seq: nextSeq(),
				status: "failed",
			});
			throw e;
		}
	}

	const finalStatus: PlanStatus = "completed";
	updatePlanStatus(currentPlan.id, finalStatus);
	emitChatEvent({
		type: "plan_completed",
		planId: currentPlan.id,
		seq: nextSeq(),
		status: finalStatus,
	});

	return loadPlan(currentPlan.id) ?? { ...currentPlan, status: finalStatus };
}
