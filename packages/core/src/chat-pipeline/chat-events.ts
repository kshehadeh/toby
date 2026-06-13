import type { PlanPhaseStatus, PlanStatus } from "../planning/types";

/**
 * UI-agnostic events emitted during a chat turn (pretreatment, model, tools, plans).
 * Presentation (colors, borders) lives in UI adapters only.
 */

export type ChatEvent =
	| {
			readonly type: "prep_start";
			readonly id: string;
			readonly seq: number;
			readonly header: string;
	  }
	| {
			readonly type: "prep_end";
			readonly id: string;
			readonly seq: number;
			readonly detail: string;
	  }
	| {
			/** Non–prompt-prep milestones (integration context, persistence, etc.). */
			readonly type: "lifecycle_start";
			readonly id: string;
			readonly seq: number;
			readonly header: string;
	  }
	| {
			readonly type: "lifecycle_end";
			readonly id: string;
			readonly seq: number;
			readonly detail: string;
	  }
	| {
			readonly type: "lifecycle_append";
			readonly id: string;
			readonly seq: number;
			readonly line: string;
	  }
	| {
			/** Replaces the lifecycle body with a single status line (boot progress). */
			readonly type: "lifecycle_set";
			readonly id: string;
			readonly seq: number;
			readonly line: string;
	  }
	| {
			readonly type: "reasoning_start";
			readonly id: string;
			readonly seq: number;
	  }
	| {
			readonly type: "reasoning_delta";
			readonly segmentId: string;
			readonly seq: number;
			readonly delta: string;
	  }
	| {
			readonly type: "reasoning_end";
			readonly id: string;
			readonly seq: number;
	  }
	| {
			readonly type: "assistant_segment_start";
			readonly id: string;
			readonly seq: number;
			readonly header: string;
	  }
	| {
			readonly type: "assistant_text_delta";
			readonly segmentId: string;
			readonly seq: number;
			readonly delta: string;
	  }
	| {
			readonly type: "assistant_segment_end";
			readonly id: string;
			readonly seq: number;
	  }
	| {
			readonly type: "tool_call_start";
			readonly blockKey: string;
			readonly seq: number;
			readonly toolName: string;
			readonly integrationLabel?: string;
			readonly args: Record<string, unknown>;
	  }
	| {
			readonly type: "tool_call_complete";
			readonly blockKey: string;
			readonly seq: number;
			readonly toolName: string;
			readonly integrationLabel?: string;
			readonly args: Record<string, unknown>;
			readonly result: unknown;
			readonly error?: unknown;
			readonly cacheHit?: boolean;
	  }
	| {
			readonly type: "plan_created";
			readonly id: string;
			readonly seq: number;
			readonly goal: string;
			readonly phaseCount: number;
	  }
	| {
			readonly type: "plan_phase_start";
			readonly planId: string;
			readonly phaseId: string;
			readonly seq: number;
			readonly label: string;
			readonly index: number;
			readonly total: number;
	  }
	| {
			readonly type: "plan_phase_end";
			readonly planId: string;
			readonly phaseId: string;
			readonly seq: number;
			readonly status: PlanPhaseStatus;
	  }
	| {
			readonly type: "plan_amended";
			readonly planId: string;
			readonly seq: number;
			readonly detail: string;
	  }
	| {
			readonly type: "plan_completed";
			readonly planId: string;
			readonly seq: number;
			readonly status: PlanStatus;
	  }
	| {
			/** Server waits for client answer via ask-user HTTP endpoint. */
			readonly type: "ask_user_prompt";
			readonly turnId: string;
			readonly requestId: string;
			readonly seq: number;
			readonly query: string;
			readonly options: readonly string[];
	  };

export type ChatEventSink = (event: ChatEvent) => void;
