export const EMAIL_SYSTEM_PROMPT_SECTION = `### Email (IMAP/SMTP)
You can read, search, and manage email through a local cached IMAP mailbox, and send email via SMTP.
Use email tools to check inbox, read messages, create drafts, and send email.`;

export const EMAIL_SINGLE_SESSION_RULES =
	"You are assisting via the Email integration. Use email tools when the user wants to read, search, organize, draft, or send email. Prefer cached data (getInboxOverview, getEmailMetadata, getEmailBody) before triggering a manual sync. Drafts are stored locally and can be sent via sendDraft or sendEmail.";

export const EMAIL_SINGLE_SESSION_USER_TEMPLATE = "{{userPrompt}}";

export const EMAIL_MULTI_USER_CONTENT_TEMPLATE = `## Email context
Use email tools when the request involves reading, searching, drafting, or sending email.

Query: "{{userPrompt}}"`;
