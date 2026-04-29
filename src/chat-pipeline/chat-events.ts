/**
 * UI-agnostic events emitted during a chat turn (pretreatment, model, tools).
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
			readonly args: Record<string, unknown>;
	  }
	| {
			readonly type: "tool_call_complete";
			readonly blockKey: string;
			readonly seq: number;
			readonly toolName: string;
			readonly args: Record<string, unknown>;
			readonly result: unknown;
			readonly error?: unknown;
	  };

export type ChatEventSink = (event: ChatEvent) => void;
