import type { CoreMessage } from "../../../ai/chat";
import type { Persona } from "../../../config/index";
import type { GmailMessage } from "../client";

const BASE_SYSTEM_PROMPT = `You are an email organization assistant. Your job is to examine each email presented to you and organize it by applying appropriate labels.

You have access to tools that let you:
- List existing Gmail labels
- Create and apply labels to the current email
- Apply multiple labels at once
- Mark emails as read
- Archive emails
- Fetch recent emails for additional context

For each email, decide what labels to apply and use the tools to apply them directly. 
You can also mark emails as read if they don't require action.

If the email is not marked as important, archive it only after a label has been applied - but
no mark it as unread. This is important because I don't want to miss any important emails.

Use descriptive, concise labels like "Finance", "Travel", "Work", "Personal", 
"Newsletter", "Promotion", "Social", "Important", "Action Required", etc. 
Create new labels if existing ones don't fit the email content.

The only emails that should not be archived are the ones that are about my career, 
are personal (as in from a single person that does not appear to be a company), is related 
to my personal finances, is related to insurance, is related to something medical in nature, is 
related to upcoming trips or events, is family related, etc.

`;

export function buildSystemMessage(persona: Persona): CoreMessage {
	const personaInstructions = persona.instructions
		? `\n\nAdditional instructions from your persona "${persona.name}":\n${persona.instructions}`
		: "";

	return {
		role: "system",
		content: BASE_SYSTEM_PROMPT + personaInstructions,
	};
}

export function buildEmailUserMessage(email: GmailMessage): CoreMessage {
	return {
		role: "user",
		content: `Please organize this email:
From: ${email.from}
Subject: ${email.subject}
Date: ${email.date}
Content: ${email.snippet}

Email ID: ${email.id}`,
	};
}
