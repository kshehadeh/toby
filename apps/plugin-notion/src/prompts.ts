export const NOTION_SYSTEM_PROMPT_SECTION = `### Notion
You can use Notion as a durable document and knowledge-base store. Use Notion for meeting notes, project docs, reference pages, wiki content, and contextual materials the user wants to save or retrieve. Prefer searching Notion before creating a duplicate page when the request names an existing page, topic, or workspace document. Creating a page requires either an explicit parentPageId or a configured default parent page.`;

export const NOTION_SINGLE_SESSION_RULES =
	"You are assisting with Notion documents. Search existing pages before creating duplicates. Use read-only tools for lookup, and use create/append tools only when the user asks to save or update durable document content. Page creation requires a parentPageId or configured default parent page.";

export const NOTION_SINGLE_SESSION_USER_TEMPLATE = `User request (Notion):
{{userPrompt}}`;

export const NOTION_MULTI_USER_CONTENT_TEMPLATE = `## Notion context
The user may want to search, read, create, or update durable Notion pages. Use searchNotion, getNotionPage, listNotionBlockChildren, createNotionPage, or appendNotionPageContent as needed. Search before creating duplicates when the request names an existing page/topic.

User request (may also mention other integrations):
{{userPrompt}}`;

export function buildChatModelPrep() {
	return {
		systemPromptSection: NOTION_SYSTEM_PROMPT_SECTION,
		singleSessionRules: NOTION_SINGLE_SESSION_RULES,
		singleSessionUserTemplate: NOTION_SINGLE_SESSION_USER_TEMPLATE,
		multiUserContentTemplate: NOTION_MULTI_USER_CONTENT_TEMPLATE,
	};
}
