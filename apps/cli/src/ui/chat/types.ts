import type { AskUserToolResult } from "@toby/core/ai/ask-user-tool";
import type {
	ToolRunEntry,
	TranscriptEntry,
} from "@toby/core/chat-pipeline/transcript-types";

export type { ToolRunEntry, TranscriptEntry };

export type DisplayRow =
	| { readonly kind: "user"; readonly text: string }
	| { readonly kind: "spacer"; readonly rowKey: string }
	| {
			readonly kind: "boxed_block";
			readonly id: string;
			readonly variant:
				| "prep"
				| "lifecycle"
				| "assistant"
				| "assistant_interim"
				| "tool"
				| "plan"
				| "meta"
				| "thinking";
			readonly header: string;
			readonly bodyLines: readonly string[];
			readonly leadingGlyph: string;
			readonly integrationLabel?: string;
			readonly cacheHit?: boolean;
	  }
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
	| {
			readonly kind: "notice";
			readonly text: string;
			readonly tone?: "info" | "success" | "error";
	  }
	| { readonly kind: "error"; readonly text: string };

export type AskModal = {
	readonly query: string;
	readonly options: string[];
	readonly resolve: (r: AskUserToolResult) => void;
};
