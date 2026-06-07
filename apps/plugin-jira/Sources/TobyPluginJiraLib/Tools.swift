import Foundation

public enum JiraTools {
	public static var definitions: [[String: Any]] {
		[
			tool(
				name: "searchJiraIssues",
				description:
					"Search Jira issues using JQL (Jira Query Language). Returns matching issues with key, summary, status, assignee, and priority. Use JQL syntax like: assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC",
				readOnly: true,
				properties: [
					"jql": prop("string", "JQL query string. Examples: 'project = PROJ', 'assignee = currentUser() AND status != Done', 'key = PROJ-123'"),
					"maxResults": prop("number", "Maximum issues to return (1-100, default 50)", optional: true),
					"nextPageToken": prop("string", "Token for fetching the next page of results (from previous search response)", optional: true),
				],
				required: ["jql"]
			),
			tool(
				name: "getJiraIssue",
				description:
					"Get full details of a Jira issue by its key (e.g. PROJ-123). Returns summary, description, status, assignee, priority, labels, and more.",
				readOnly: true,
				properties: [
					"issueKey": prop("string", "Jira issue key, e.g. PROJ-123"),
				],
				required: ["issueKey"]
			),
			tool(
				name: "getJiraIssueComments",
				description:
					"Get comments for a Jira issue by its key. Returns paginated comments with author, body, and timestamps.",
				readOnly: true,
				properties: [
					"issueKey": prop("string", "Jira issue key, e.g. PROJ-123"),
					"maxResults": prop("number", "Maximum comments to return (1-100, default 50)", optional: true),
					"startAt": prop("number", "Offset for pagination (default 0)", optional: true),
				],
				required: ["issueKey"]
			),
			tool(
				name: "listJiraProjects",
				description:
					"List Jira projects accessible to the authenticated user. Returns project key, name, and type.",
				readOnly: true,
				properties: [
					"maxResults": prop("number", "Maximum projects to return (1-100, default 50)", optional: true),
					"startAt": prop("number", "Offset for pagination (default 0)", optional: true),
				]
			),
		]
	}

	public struct ExecuteResult {
		public let result: [String: Any]
		public let appliedActions: [String]
	}

	public static func execute(
		tool name: String,
		input: [String: Any],
		config: [String: Any],
		dryRun: Bool
	) -> Result<ExecuteResult, JiraFailure> {
		switch name {
		case "searchJiraIssues":
			guard let jql = stringValue(input["jql"])?.trimmingCharacters(in: .whitespacesAndNewlines),
				!jql.isEmpty
			else {
				return .failure(JiraFailure(message: "jql is required."))
			}
			if dryRun {
				let msg = "[DRY RUN] Would search Jira with JQL: \"\(jql)\""
				return .success(ExecuteResult(result: ["dryRun": true, "message": msg, "jql": jql], appliedActions: [msg]))
			}
			do {
				let response = try JiraClient.searchIssues(
					config: config,
					jql: jql,
					maxResults: intValue(input["maxResults"]) ?? 50,
					nextPageToken: stringValue(input["nextPageToken"])
				)
				let count = intValue(response["issueCount"]) ?? 0
				let msg = "Jira search: \"\(jql)\" — \(count) result(s)"
				return .success(ExecuteResult(result: response, appliedActions: [msg]))
			} catch {
				return .failure(error as? JiraFailure ?? JiraFailure(message: error.localizedDescription))
			}

		case "getJiraIssue":
			guard let issueKey = stringValue(input["issueKey"])?.trimmingCharacters(in: .whitespacesAndNewlines),
				!issueKey.isEmpty
			else {
				return .failure(JiraFailure(message: "issueKey is required."))
			}
			if dryRun {
				let msg = "[DRY RUN] Would fetch Jira issue \"\(issueKey)\""
				return .success(ExecuteResult(result: ["dryRun": true, "message": msg, "issueKey": issueKey], appliedActions: [msg]))
			}
			do {
				let issue = try JiraClient.getIssue(config: config, issueKey: issueKey)
				let msg = "Fetched Jira issue \"\(issueKey)\""
				return .success(ExecuteResult(result: issue, appliedActions: [msg]))
			} catch {
				return .failure(error as? JiraFailure ?? JiraFailure(message: error.localizedDescription))
			}

		case "getJiraIssueComments":
			guard let issueKey = stringValue(input["issueKey"])?.trimmingCharacters(in: .whitespacesAndNewlines),
				!issueKey.isEmpty
			else {
				return .failure(JiraFailure(message: "issueKey is required."))
			}
			if dryRun {
				let msg = "[DRY RUN] Would fetch comments for Jira issue \"\(issueKey)\""
				return .success(ExecuteResult(result: ["dryRun": true, "message": msg, "issueKey": issueKey], appliedActions: [msg]))
			}
			do {
				let response = try JiraClient.getIssueComments(
					config: config,
					issueKey: issueKey,
					startAt: intValue(input["startAt"]) ?? 0,
					maxResults: intValue(input["maxResults"]) ?? 50
				)
				let comments = response["comments"] as? [[String: Any]] ?? []
				let total = intValue(response["total"]) ?? comments.count
				let msg = "Fetched \(comments.count)/\(total) comment(s) for Jira issue \"\(issueKey)\""
				return .success(ExecuteResult(result: response, appliedActions: [msg]))
			} catch {
				return .failure(error as? JiraFailure ?? JiraFailure(message: error.localizedDescription))
			}

		case "listJiraProjects":
			if dryRun {
				let msg = "[DRY RUN] Would list Jira projects"
				return .success(ExecuteResult(result: ["dryRun": true, "message": msg], appliedActions: [msg]))
			}
			do {
				let response = try JiraClient.listProjects(
					config: config,
					startAt: intValue(input["startAt"]) ?? 0,
					maxResults: intValue(input["maxResults"]) ?? 50
				)
				let projects = response["projects"] as? [[String: Any]] ?? []
				let total = intValue(response["total"]) ?? projects.count
				let msg = "Fetched \(projects.count)/\(total) Jira project(s)"
				return .success(ExecuteResult(result: response, appliedActions: [msg]))
			} catch {
				return .failure(error as? JiraFailure ?? JiraFailure(message: error.localizedDescription))
			}

		default:
			return .failure(JiraFailure(message: "Unknown tool: \(name)"))
		}
	}

	private static func tool(
		name: String,
		description: String,
		readOnly: Bool = false,
		properties: [String: Any],
		required: [String] = []
	) -> [String: Any] {
		var schema: [String: Any] = [
			"type": "object",
			"properties": properties,
		]
		if !required.isEmpty {
			schema["required"] = required
		}
		var def: [String: Any] = [
			"name": name,
			"description": description,
			"inputSchema": schema,
		]
		if readOnly { def["readOnly"] = true }
		return def
	}

	private static func prop(_ type: String, _ description: String, optional: Bool = false) -> [String: Any] {
		var p: [String: Any] = ["type": type, "description": description]
		if optional { _ = optional }
		return p
	}

	private static func stringValue(_ value: Any?) -> String? {
		if let s = value as? String { return s }
		if let n = value as? NSNumber { return n.stringValue }
		return nil
	}

	private static func intValue(_ value: Any?) -> Int? {
		if let n = value as? Int { return n }
		if let d = value as? Double { return Int(d) }
		if let n = value as? NSNumber { return n.intValue }
		return nil
	}
}
