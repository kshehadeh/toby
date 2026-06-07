import Foundation

public enum WebSearchTools {
	public static var definitions: [[String: Any]] {
		[
			tool(
				name: "webSearch",
				description:
					"Search the web using Brave Search. Returns a list of results with title, URL, description, and optional page age. Use this to find information on the web, research topics, or look up facts.",
				readOnly: true,
				properties: [
					"query": prop("string", "The search query"),
					"count": prop("number", "Number of results to return (1-20, default 10)", optional: true),
					"freshness": prop(
						"string",
						"Time filter: pd=past day, pw=past week, pm=past month, py=past year",
						optional: true
					),
				],
				required: ["query"]
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
	) -> Result<ExecuteResult, SearchFailure> {
		switch name {
		case "webSearch":
			guard let query = stringValue(input["query"])?.trimmingCharacters(in: .whitespacesAndNewlines),
				!query.isEmpty
			else {
				return .failure(SearchFailure(message: "query is required."))
			}

			if dryRun {
				let msg = "[DRY RUN] Would search the web for: \"\(query)\""
				return .success(
					ExecuteResult(
						result: ["dryRun": true, "message": msg, "query": query],
						appliedActions: [msg]
					)
				)
			}

			do {
				let count = intValue(input["count"]) ?? 10
				let freshness = stringValue(input["freshness"])
				let response = try SearchClient.webSearch(
					config: config,
					query: query,
					count: count,
					freshness: freshness
				)
				let results = response["results"] as? [[String: Any]] ?? []
				let msg = "Web search: \"\(query)\" — \(results.count) result(s)"
				return .success(ExecuteResult(result: response, appliedActions: [msg]))
			} catch {
				return .failure(error as? SearchFailure ?? SearchFailure(message: error.localizedDescription))
			}

		default:
			return .failure(SearchFailure(message: "Unknown tool: \(name)"))
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
