import type { CoreMessage } from "../../../ai/chat";
import type { Persona } from "../../../config/index";
import type { GmailMessage } from "../client";

const BASE_GMAIL_SUMMARY_SYSTEM_PROMPT = `You are an email summarization assistant.

Your task is to summarize unread inbox email clearly and concisely.

Output rules:
- Keep the summary brief but complete.
- Prioritize the most important items first (time-sensitive, personal, medical, financial, work/career, family, travel/events).
- Group low-priority or repetitive emails together by theme/sender (e.g., receipts, shipping updates, promotions).
- Use plain language and avoid unnecessary jargon.
- Mention key senders and key actions/deadlines when present.
- Do not invent details that are not in the provided emails.

Preferred format:
1) 1-3 sentence high-level overview
2) A short bullet list of most relevant items
3) One short sentence grouping lower-priority items`;

export function buildGmailSummarySystemMessage(persona?: Persona): CoreMessage {
	const personaInstructions = persona?.instructions
		? `\n\nAdditional instructions from your persona "${persona.name}":\n${persona.instructions}`
		: "";

	return {
		role: "system",
		content: BASE_GMAIL_SUMMARY_SYSTEM_PROMPT + personaInstructions,
	};
}

export function buildGmailSummaryUserMessage(
	emails: GmailMessage[],
): CoreMessage {
	const emailLines = emails
		.map(
			(email, index) =>
				`Email ${index + 1}
From: ${email.from}
Subject: ${email.subject}
Date: ${email.date}
Snippet: ${email.snippet}`,
		)
		.join("\n\n");

	return {
		role: "user",
		content: `Summarize these unread inbox emails:\n\n${emailLines}`,
	};
}
