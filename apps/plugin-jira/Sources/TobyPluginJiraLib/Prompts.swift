import Foundation

public enum Prompts {
	static let systemPromptSection = """
	### Jira
	You can search and read Jira issues and projects. Use searchJiraIssues for JQL-based searches, getJiraIssue for full issue details, getJiraIssueComments for issue comments, and listJiraProjects for accessible projects. All operations are read-only.
	"""

	static let singleSessionRules = """
	You are assisting with Jira issue tracking. Use the available tools to search issues, get issue details, read comments, and list projects. All tools are read-only — you can look up information but cannot create or modify issues.
	"""

	static let singleSessionUserTemplate = """
	User request (Jira):
	{{userPrompt}}
	"""

	static let multiUserContentTemplate = """
	## Jira context
	The user may want to look up Jira issues or projects. Use searchJiraIssues, getJiraIssue, getJiraIssueComments, or listJiraProjects as needed.

	User request (may also mention other integrations):
	{{userPrompt}}
	"""

	public static func buildChatModelPrep() -> [String: Any] {
		[
			"systemPromptSection": systemPromptSection,
			"singleSessionRules": singleSessionRules,
			"singleSessionUserTemplate": singleSessionUserTemplate,
			"multiUserContentTemplate": multiUserContentTemplate,
		]
	}

	public static func buildChatReadiness(config: [String: Any], state: [String: Any]) -> [String: Any] {
		if PluginOutput.isConnected(config: config, state: state) || JiraClient.hasCredentials(config: config) {
			return ["ok": true]
		}
		return [
			"ok": false,
			"hint":
				"Add Jira credentials (domain, email, API token) in `toby configure` or run `toby connect jira`.",
		]
	}
}
