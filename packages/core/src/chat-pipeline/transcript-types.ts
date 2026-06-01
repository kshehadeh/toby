export type ToolRunEntry = {
	readonly blockKey: string;
	readonly header: string;
	readonly body: string;
	readonly cacheHit?: boolean;
};

export type TranscriptEntry =
	| { readonly kind: "user"; readonly text: string }
	| { readonly kind: "assistant"; readonly text: string }
	| { readonly kind: "meta"; readonly text: string }
	| { readonly kind: "error"; readonly text: string }
	| {
			readonly kind: "boxed_step";
			readonly id: string;
			readonly seq: number;
			readonly variant: "prep" | "lifecycle" | "assistant" | "tool" | "plan";
			readonly header: string;
			readonly body: string;
			readonly toolBlockKey?: string;
			/** Set when `variant` is `"tool"` — used for transcript icon only. */
			readonly toolName?: string;
			readonly integrationLabel?: string;
			readonly cacheHit?: boolean;
			/** Optional grouped runs for consecutive calls to the same tool. */
			readonly toolRuns?: readonly ToolRunEntry[];
	  }
	| {
			readonly kind: "tool_call";
			readonly blockKey: string;
			readonly title: string;
	  }
	| {
			readonly kind: "tool_output";
			readonly blockKey: string;
			readonly detail: string;
	  }
	| {
			readonly kind: "ask_user_qa";
			readonly blockKey: string;
			readonly query: string;
			/** The chosen option text (empty if cancelled / error). */
			readonly answer: string;
			readonly error?: string;
	  };
