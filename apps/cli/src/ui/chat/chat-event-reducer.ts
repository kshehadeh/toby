export {
	applyChatEvent,
	applyPersistedChatEvent,
	shouldPersistChatEventInTranscript,
	formatToolCallHeader,
	setToolOutputFormatter,
	formatToolOutput,
} from "@toby/core/chat-pipeline/transcript-reducer";
import { setToolOutputFormatter } from "@toby/core/chat-pipeline/transcript-reducer";
import { formatToolFeedbackOutput } from "./tool-feedback-registry";

setToolOutputFormatter((ctx) => formatToolFeedbackOutput(ctx));
