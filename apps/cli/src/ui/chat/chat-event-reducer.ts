export {
	applyChatEvent,
	applyPersistedChatEvent,
	shouldPersistChatEventInTranscript,
	formatToolCallHeader,
	setToolOutputFormatter,
	setToolOutputFullFormatter,
	formatToolOutput,
	formatToolOutputFull,
} from "@toby/core/chat-pipeline/transcript-reducer";
import {
	setToolOutputFormatter,
	setToolOutputFullFormatter,
} from "@toby/core/chat-pipeline/transcript-reducer";
import {
	formatToolFeedbackOutput,
	formatToolFeedbackOutputFull,
} from "./tool-feedback-registry";

setToolOutputFormatter((ctx) => formatToolFeedbackOutput(ctx));
setToolOutputFullFormatter((ctx) => formatToolFeedbackOutputFull(ctx));
