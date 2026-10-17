import type { ToolPresentation } from "./tool-presentation";

export type NoticeTone = "info" | "success" | "error";

export type ToolRunEntry = {
	readonly blockKey: string;
	readonly header: string;
	readonly body: string;
	readonly cacheHit?: boolean;
	/** Elapsed time for this run in milliseconds, when known. */
	readonly durationMs?: number;
	/** Full untruncated output, when it differs from `body`. */
	readonly fullBody?: string;
	/** Display-safe tool arguments (see `sanitizeToolArgsForDisplay`). */
	readonly args?: ToolDisplayArgs;
	/** True when the call errored or returned `{ error }`. */
	readonly failed?: boolean;
};

export type ToolDisplayArgs = Readonly<
	Record<string, string | number | boolean | readonly string[]>
>;

export type TranscriptAttachment = {
	readonly filename: string;
	readonly mediaType: string;
	readonly dataBase64: string;
	readonly byteSize: number;
};

/** ISO-8601 timestamp for transcript message chrome (`4m ago`). */
export function transcriptTimestampNow(): string {
	return new Date().toISOString();
}

export type TranscriptEntry =
	| {
			readonly kind: "user";
			readonly text: string;
			readonly attachments?: readonly TranscriptAttachment[];
			readonly createdAt?: string;
	  }
	| {
			readonly kind: "assistant";
			readonly text: string;
			readonly createdAt?: string;
	  }
	| { readonly kind: "meta"; readonly text: string }
	| {
			readonly kind: "notice";
			readonly text: string;
			readonly tone?: NoticeTone;
	  }
	| { readonly kind: "error"; readonly text: string }
	| {
			readonly kind: "boxed_step";
			readonly id: string;
			readonly seq: number;
			readonly variant:
				| "prep"
				| "lifecycle"
				| "assistant"
				| "assistant_interim"
				| "tool"
				| "plan"
				| "thinking";
			readonly header: string;
			readonly body: string;
			readonly toolBlockKey?: string;
			/** Set when `variant` is `"tool"` — used for transcript icon only. */
			readonly toolName?: string;
			readonly integrationLabel?: string;
			readonly cacheHit?: boolean;
			/** Elapsed time for this step in milliseconds, when known. */
			readonly durationMs?: number;
			/** Optional grouped runs for consecutive calls to the same tool. */
			readonly toolRuns?: readonly ToolRunEntry[];
			/** Full untruncated output, when it differs from `body`. */
			readonly fullBody?: string;
			/** Display-safe tool arguments for single-call tool steps. */
			readonly args?: ToolDisplayArgs;
			/** True when a single-call tool step failed. */
			readonly failed?: boolean;
			/** Renderer hint for tool steps. */
			readonly presentation?: ToolPresentation;
			/** ISO-8601 timestamp for assistant segments shown in the transcript. */
			readonly createdAt?: string;
	  }
	| {
			readonly kind: "tool_call";
			readonly blockKey: string;
			readonly title: string;
			/** Raw tool name for display labels and icons. */
			readonly toolName?: string;
	  }
	| {
			readonly kind: "tool_output";
			readonly blockKey: string;
			readonly detail: string;
			/** Raw tool name for display labels and icons. */
			readonly toolName?: string;
	  }
	| {
			readonly kind: "ask_user_qa";
			readonly blockKey: string;
			readonly query: string;
			/** The chosen option text (empty if cancelled / error). */
			readonly answer: string;
			readonly error?: string;
	  }
	| {
			/** Persisted duration of pipeline work before the assistant reply (milliseconds). */
			readonly kind: "turn_work";
			readonly durationMs: number;
	  };
