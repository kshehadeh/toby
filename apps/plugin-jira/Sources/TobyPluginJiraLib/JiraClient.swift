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

	public static func buildGatewayHost(cloudId: String) -> String {
		let trimmed = cloudId.trimmingCharacters(in: .whitespacesAndNewlines)
		return "https://api.atlassian.com/ex/jira/\(trimmed)"
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

	nonisolated(unsafe) private static var cloudIdCache: [String: String] = [:]
	nonisolated(unsafe) private static var apiBaseCache: [String: String] = [:]

	private struct HTTPResult {
		let data: Data
		let statusCode: Int
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

		let siteHost = buildHost(domain: creds.domain)
		if let cachedBase = apiBaseCache[siteHost] {
			let result = try performHTTP(
				base: cachedBase,
				path: path,
				method: method,
				body: body,
				creds: creds
			)
			if result.statusCode < 400 {
				return result.data
			}
			let message = parseErrorMessage(result.data) ?? "HTTP \(result.statusCode)"
			throw JiraFailure(message: message)
		}

		let siteResult = try performHTTP(
			base: siteHost,
			path: path,
			method: method,
			body: body,
			creds: creds
		)
		if siteResult.statusCode < 400 {
			apiBaseCache[siteHost] = siteHost
			return siteResult.data
		}

		if siteResult.statusCode == 401 || siteResult.statusCode == 403,
			let cloudId = fetchCloudId(siteHost: siteHost)
		{
			let gatewayHost = buildGatewayHost(cloudId: cloudId)
			let gatewayResult = try performHTTP(
				base: gatewayHost,
				path: path,
				method: method,
				body: body,
				creds: creds
			)
			if gatewayResult.statusCode < 400 {
				apiBaseCache[siteHost] = gatewayHost
				return gatewayResult.data
			}

			let siteMessage = parseErrorMessage(siteResult.data) ?? "HTTP \(siteResult.statusCode)"
			let gatewayMessage =
				parseErrorMessage(gatewayResult.data) ?? "HTTP \(gatewayResult.statusCode)"
			throw JiraFailure(
				message: authFailureMessage(
					siteMessage: siteMessage,
					gatewayMessage: gatewayMessage
				)
			)
		}

		let message = parseErrorMessage(siteResult.data) ?? "HTTP \(siteResult.statusCode)"
		throw JiraFailure(message: message)
	}

	private static func performHTTP(
		base: String,
		path: String,
		method: String,
		body: [String: Any]?,
		creds: (domain: String, email: String, apiToken: String)
	) throws -> HTTPResult {
		guard let url = URL(string: base + path) else {
			throw JiraFailure(message: "Invalid Jira URL.")
		}

		var request = URLRequest(url: url)
		request.httpMethod = method
		request.setValue("application/json", forHTTPHeaderField: "Accept")
		if body != nil {
			request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		}

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
			resultData = data ?? Data()
		}
		task.resume()
		semaphore.wait()

		if let resultError {
			throw JiraFailure(message: resultError.localizedDescription)
		}

		return HTTPResult(data: resultData ?? Data(), statusCode: statusCode)
	}

	private static func fetchCloudId(siteHost: String) -> String? {
		if let cached = cloudIdCache[siteHost] {
			return cached
		}

		guard let url = URL(string: siteHost + "/_edge/tenant_info") else {
			return nil
		}

		var request = URLRequest(url: url)
		request.httpMethod = "GET"
		request.setValue("application/json", forHTTPHeaderField: "Accept")

		let semaphore = DispatchSemaphore(value: 0)
		var resultData: Data?
		var statusCode = 0

		let task = URLSession.shared.dataTask(with: request) { data, response, error in
			defer { semaphore.signal() }
			guard error == nil else { return }
			if let http = response as? HTTPURLResponse {
				statusCode = http.statusCode
			}
			resultData = data
		}
		task.resume()
		semaphore.wait()

		guard statusCode < 400,
			let resultData,
			let json = try? JSONSerialization.jsonObject(with: resultData) as? [String: Any],
			let cloudId = stringValue(json["cloudId"])?.trimmingCharacters(in: .whitespacesAndNewlines),
			!cloudId.isEmpty
		else {
			return nil
		}

		cloudIdCache[siteHost] = cloudId
		return cloudId
	}

	private static func authFailureMessage(siteMessage: String, gatewayMessage: String) -> String {
		"\(siteMessage) (site URL). Scoped-token gateway retry also failed: \(gatewayMessage). " +
			"Create a new classic API token (without scopes), or a scoped token with Jira read scopes. " +
			"Confirm the email matches the Atlassian account that owns the token."
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
