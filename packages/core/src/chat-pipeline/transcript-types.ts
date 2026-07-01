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
};

export type TranscriptEntry =
	| { readonly kind: "user"; readonly text: string }
	| { readonly kind: "assistant"; readonly text: string }
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
