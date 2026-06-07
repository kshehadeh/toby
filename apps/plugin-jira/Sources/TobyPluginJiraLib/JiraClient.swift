import Foundation

public enum JiraClient {
	private static let searchFields = [
		"summary",
		"status",
		"assignee",
		"priority",
		"issuetype",
		"project",
		"updated",
		"created",
		"labels",
		"description",
	]

	public static func hasCredentials(config: [String: Any]) -> Bool {
		credentials(from: config) != nil
	}

	public static func credentials(from config: [String: Any]) -> (domain: String, email: String, apiToken: String)? {
		guard let domain = stringValue(config["domain"])?.trimmingCharacters(in: .whitespacesAndNewlines),
			!domain.isEmpty,
			let email = stringValue(config["email"])?.trimmingCharacters(in: .whitespacesAndNewlines),
			!email.isEmpty,
			let apiToken = stringValue(config["apiToken"])?.trimmingCharacters(in: .whitespacesAndNewlines),
			!apiToken.isEmpty
		else {
			return nil
		}
		return (domain, email, apiToken)
	}

	public static func buildHost(domain: String) -> String {
		var normalized = domain.trimmingCharacters(in: .whitespacesAndNewlines)
		normalized = normalized.replacingOccurrences(of: "https://", with: "")
		normalized = normalized.replacingOccurrences(of: "http://", with: "")
		while normalized.hasSuffix("/") {
			normalized.removeLast()
		}
		if normalized.hasSuffix(".atlassian.net") {
			return "https://\(normalized)"
		}
		return "https://\(normalized).atlassian.net"
	}

	public static func testConnection(config: [String: Any]) throws {
		guard let creds = credentials(from: config) else {
			throw JiraFailure(message: "Jira credentials not found.")
		}
		_ = try request(config: config, path: "/rest/api/3/myself", method: "GET")
		_ = creds
	}

	public static func searchIssues(
		config: [String: Any],
		jql: String,
		maxResults: Int = 50,
		nextPageToken: String? = nil
	) throws -> [String: Any] {
		var body: [String: Any] = [
			"jql": jql,
			"maxResults": max(1, min(maxResults, 100)),
			"fields": searchFields,
			"fieldsByKeys": true,
		]
		if let nextPageToken, !nextPageToken.isEmpty {
			body["nextPageToken"] = nextPageToken
		}

		let data = try request(config: config, path: "/rest/api/3/search/jql", method: "POST", body: body)
		let json = try parseJSONObject(data)
		let rawIssues = json["issues"] as? [[String: Any]] ?? []
		let issues = rawIssues.map { issue -> [String: Any] in
			let fields = issue["fields"] as? [String: Any] ?? [:]
			var summary = extractIssueSummary(fields)
			summary["key"] = stringValue(issue["key"]) ?? ""
			summary["id"] = stringValue(issue["id"]) ?? ""
			return summary
		}

		var result: [String: Any] = [
			"ok": true,
			"issueCount": issues.count,
			"issues": issues,
		]
		if let token = stringValue(json["nextPageToken"]) {
			result["nextPageToken"] = token
		}
		return result
	}

	public static func getIssue(config: [String: Any], issueKey: String) throws -> [String: Any] {
		let encoded = issueKey.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? issueKey
		let data = try request(config: config, path: "/rest/api/3/issue/\(encoded)", method: "GET")
		let json = try parseJSONObject(data)
		let fields = json["fields"] as? [String: Any] ?? [:]
		var detail = extractIssueDetail(fields)
		detail["ok"] = true
		detail["key"] = stringValue(json["key"]) ?? issueKey
		detail["id"] = stringValue(json["id"]) ?? ""
		return detail
	}

	public static func getIssueComments(
		config: [String: Any],
		issueKey: String,
		startAt: Int = 0,
		maxResults: Int = 50
	) throws -> [String: Any] {
		let encoded = issueKey.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? issueKey
		let query = "startAt=\(max(0, startAt))&maxResults=\(max(1, min(maxResults, 100)))"
		let data = try request(
			config: config,
			path: "/rest/api/3/issue/\(encoded)/comment?\(query)",
			method: "GET"
		)
		let json = try parseJSONObject(data)
		let rawComments = json["comments"] as? [[String: Any]] ?? []
		let comments = rawComments.map { comment -> [String: Any] in
			let author = comment["author"] as? [String: Any]
			return [
				"id": stringValue(comment["id"]) ?? "",
				"author": stringValue(author?["displayName"]) ?? "Unknown",
				"created": stringValue(comment["created"]) ?? "",
				"updated": stringValue(comment["updated"]) ?? "",
				"body": comment["body"] ?? NSNull(),
			]
		}

		return [
			"ok": true,
			"total": intValue(json["total"]) ?? comments.count,
			"startAt": intValue(json["startAt"]) ?? startAt,
			"comments": comments,
		]
	}

	public static func listProjects(
		config: [String: Any],
		startAt: Int = 0,
		maxResults: Int = 50
	) throws -> [String: Any] {
		let query = "startAt=\(max(0, startAt))&maxResults=\(max(1, min(maxResults, 100)))"
		let data = try request(config: config, path: "/rest/api/3/project/search?\(query)", method: "GET")
		let json = try parseJSONObject(data)
		let values = json["values"] as? [[String: Any]] ?? []
		let projects = values.map { project -> [String: Any] in
			[
				"key": stringValue(project["key"]) ?? "",
				"name": stringValue(project["name"]) ?? "",
				"id": stringValue(project["id"]) ?? "",
				"type": stringValue(project["projectTypeKey"]) ?? "",
			]
		}

		return [
			"ok": true,
			"total": intValue(json["total"]) ?? projects.count,
			"projects": projects,
		]
	}

	public static func validateTools() -> [[String: Any]] {
		let toolNames = JiraTools.definitions.compactMap { $0["name"] as? String }
		return toolNames.map { name in
			[
				"tool": name,
				"ok": true,
				"details": "Tool is available.",
			]
		}
	}

	private static func extractIssueSummary(_ fields: [String: Any]) -> [String: Any] {
		let project = fields["project"] as? [String: Any]
		let projectKey = stringValue(project?["key"]) ?? ""
		let projectName = stringValue(project?["name"]) ?? ""
		let projectStr = projectKey.isEmpty && projectName.isEmpty ? "" : "\(projectKey) - \(projectName)"
		let status = fields["status"] as? [String: Any]
		let assignee = fields["assignee"] as? [String: Any]
		let priority = fields["priority"] as? [String: Any]
		let issuetype = fields["issuetype"] as? [String: Any]

		return [
			"summary": stringValue(fields["summary"]) ?? "",
			"status": stringValue(status?["name"]) ?? "",
			"assignee": stringValue(assignee?["displayName"]) ?? "Unassigned",
			"priority": stringValue(priority?["name"]) ?? "",
			"issuetype": stringValue(issuetype?["name"]) ?? "",
			"project": projectStr,
			"updated": stringValue(fields["updated"]) ?? "",
		]
	}

	private static func extractIssueDetail(_ fields: [String: Any]) -> [String: Any] {
		let project = fields["project"] as? [String: Any]
		let status = fields["status"] as? [String: Any]
		let assignee = fields["assignee"] as? [String: Any]
		let priority = fields["priority"] as? [String: Any]
		let issuetype = fields["issuetype"] as? [String: Any]
		let labels = fields["labels"] as? [String] ?? []

		var detail: [String: Any] = [
			"summary": stringValue(fields["summary"]) ?? "",
			"status": stringValue(status?["name"]) ?? "",
			"assignee": stringValue(assignee?["displayName"]) ?? "Unassigned",
			"priority": stringValue(priority?["name"]) ?? "None",
			"issuetype": stringValue(issuetype?["name"]) ?? "",
			"labels": labels,
			"created": stringValue(fields["created"]) ?? "",
			"updated": stringValue(fields["updated"]) ?? "",
			"description": fields["description"] ?? NSNull(),
		]

		if let project {
			detail["project"] = [
				"key": stringValue(project["key"]) ?? "",
				"name": stringValue(project["name"]) ?? "",
			]
		} else {
			detail["project"] = NSNull()
		}

		return detail
	}

	private static func request(
		config: [String: Any],
		path: String,
		method: String,
		body: [String: Any]? = nil
	) throws -> Data {
		guard let creds = credentials(from: config) else {
			throw JiraFailure(message: "Jira credentials not found.")
		}

		let host = buildHost(domain: creds.domain)
		guard let url = URL(string: host + path) else {
			throw JiraFailure(message: "Invalid Jira URL.")
		}

		var request = URLRequest(url: url)
		request.httpMethod = method
		request.setValue("application/json", forHTTPHeaderField: "Accept")
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")

		let authString = "\(creds.email):\(creds.apiToken)"
		guard let authData = authString.data(using: .utf8) else {
			throw JiraFailure(message: "Failed to encode credentials.")
		}
		request.setValue("Basic \(authData.base64EncodedString())", forHTTPHeaderField: "Authorization")

		if let body {
			request.httpBody = try JSONSerialization.data(withJSONObject: body)
		}

		let semaphore = DispatchSemaphore(value: 0)
		var resultData: Data?
		var resultError: Error?
		var statusCode = 0

		let task = URLSession.shared.dataTask(with: request) { data, response, error in
			defer { semaphore.signal() }
			if let error {
				resultError = error
				return
			}
			if let http = response as? HTTPURLResponse {
				statusCode = http.statusCode
			}
			resultData = data
		}
		task.resume()
		semaphore.wait()

		if let resultError {
			throw JiraFailure(message: resultError.localizedDescription)
		}

		guard let resultData else {
			throw JiraFailure(message: "Empty response from Jira API.")
		}

		if statusCode >= 400 {
			let message = parseErrorMessage(resultData) ?? "HTTP \(statusCode)"
			throw JiraFailure(message: message)
		}

		return resultData
	}

	private static func parseJSONObject(_ data: Data) throws -> [String: Any] {
		guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
			throw JiraFailure(message: "Invalid JSON response from Jira API.")
		}
		return json
	}

	private static func parseErrorMessage(_ data: Data) -> String? {
		guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
			return String(data: data, encoding: .utf8)
		}
		if let messages = json["errorMessages"] as? [String], let first = messages.first {
			return first
		}
		if let errors = json["errors"] as? [String: Any], let first = errors.values.first as? String {
			return first
		}
		if let message = stringValue(json["message"]) {
			return message
		}
		return nil
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
