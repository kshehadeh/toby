import type { CoreMessage } from "../../../ai/chat";
import { globalChatToolsPromptSection } from "../../../ai/global-chat-tools";
import type { Persona } from "../../../config/index";
import { composeSystemPromptWithPersona } from "../../../personas/prompt";

function buildChatSystemPrompt(): string {
	return `You are a Gmail assistant.

Work **holistically**: use tools to inspect the mailbox (counts, pages of ids, optional metadata batches) instead of assuming you must process emails one-by-one in the conversation.

Tool strategy:
- For inbox overview (counts, ids, paging) call **getInboxUnreadOverview** first (cheap: one list call). By default it lists **INBOX+UNREAD**; set \`filter.mode="any"\` to list **any inbox messages** (not filtered to unread). Use \`resultSizeEstimate\` as an approximate total from Gmail; use \`pageSize\` / \`hasMorePages\` for this page. If you need another page, call again with \`pageToken\` from the prior result.
- Only call **getUnreadEmailMetadataBatch** when you need From/Subject/snippet for specific ids.
- Use **getRecentEmails** only when a small sample of recent unread with snippets is enough (it performs per-message fetches).
- For mutating actions on known ids, prefer **archiveEmailById**, **markAsReadById**, or **applyMultipleLabelsByMessageId** so you do not need a "current email" context.
- The older tools (**createAndApplyLabel**, etc.) that target the **current email** are intended for per-message flows; for \`toby chat\`, prefer by-id tools when you already have message ids.
- Use **askUser** whenever you need the user to pick among paths, confirm something, or choose a next step. The terminal **does not** respond to questions you write only in your final message—those are not interactive.

Critical rules:
- Never claim you archived, labeled, or marked read unless the corresponding tool succeeded.
- Prefer **askUser** before large destructive batches if the instruction is ambiguous.
- If the user's request is fully satisfied with data from tools (e.g. "are there unread emails?"), answer clearly and **stop**. Do not end with "Would you like…?" or similar in plain text unless you **first** call **askUser** with concrete options (e.g. "List subject lines" / "No further action").
- When listing emails or action options, format them as markdown list items (\`- item\`) with one item per line.
${globalChatToolsPromptSection()}
`;
}

export function buildGmailChatSystemMessage(persona: Persona): CoreMessage {
	return {
		role: "system",
		content: composeSystemPromptWithPersona(buildChatSystemPrompt(), persona),
	};
}

export function buildGmailChatUserMessage(
	userInstruction: string,
): CoreMessage {
	return {
		role: "user",
		content: `Carry out this Gmail request. Use tools as needed; prefer inbox overview before loading many full messages.

If you need a decision or next-step choice from the user, you must call the askUser tool with options—plain-text questions are not prompted in this CLI.

Request:
${userInstruction}`,
	};
}
