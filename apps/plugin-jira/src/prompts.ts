export const JIRA_SYSTEM_PROMPT_SECTION = `### Jira
You can search and read Jira issues and projects. Use searchJiraIssues for JQL-based searches, getJiraIssue for full issue details, getJiraIssueComments for issue comments, and listJiraProjects for accessible projects. All operations are read-only.`;

export const JIRA_SINGLE_SESSION_RULES =
	"You are assisting with Jira issue tracking. Use the available tools to search issues, get issue details, read comments, and list projects. All tools are read-only — you can look up information but cannot create or modify issues.";

export const JIRA_SINGLE_SESSION_USER_TEMPLATE = `User request (Jira):
{{userPrompt}}`;

export const JIRA_MULTI_USER_CONTENT_TEMPLATE = `## Jira context
The user may want to look up Jira issues or projects. Use searchJiraIssues, getJiraIssue, getJiraIssueComments, or listJiraProjects as needed.

User request (may also mention other integrations):
{{userPrompt}}`;

export function buildChatModelPrep() {
	return {
		systemPromptSection: JIRA_SYSTEM_PROMPT_SECTION,
		singleSessionRules: JIRA_SINGLE_SESSION_RULES,
		singleSessionUserTemplate: JIRA_SINGLE_SESSION_USER_TEMPLATE,
		multiUserContentTemplate: JIRA_MULTI_USER_CONTENT_TEMPLATE,
	};
}
