import type { AskUserToolResult } from "../../ai/ask-user-tool";

export type TranscriptEntry =
	| { readonly kind: "user"; readonly text: string }
	| { readonly kind: "assistant"; readonly text: string }
	| { readonly kind: "meta"; readonly text: string }
	| { readonly kind: "error"; readonly text: string }
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

export type DisplayRow =
	| { readonly kind: "user"; readonly text: string }
	| { readonly kind: "spacer"; readonly rowKey: string }
	| {
			readonly kind: "assistant_line";
			readonly text: string;
			readonly blockKey: string;
	  }
	| {
			readonly kind: "assistant_list_item";
			readonly text: string;
			readonly marker: string;
			readonly blockKey: string;
	  }
	| {
			readonly kind: "tool_feedback_call";
			readonly blockKey: string;
			readonly title: string;
	  }
	| {
			readonly kind: "tool_feedback_output";
			readonly blockKey: string;
			readonly detail: string;
	  }
	| {
			readonly kind: "ask_user_qa";
			readonly blockKey: string;
			readonly query: string;
			readonly answer: string;
			readonly error?: string;
	  }
	| { readonly kind: "meta"; readonly text: string }
	| { readonly kind: "error"; readonly text: string };

export type AskModal = {
	readonly query: string;
	readonly options: string[];
	readonly resolve: (r: AskUserToolResult) => void;
};
