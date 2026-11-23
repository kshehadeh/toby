import Foundation
import TobyAI

/// GitHub release notes → categorized changes (port of `releases/changelog.ts`).
public enum Changelog {
	public static let repo = "kshehadeh/toby"

	static let types: [String: String] = [
		"feat": "feature", "fix": "bug", "perf": "enhancement", "refactor": "enhancement", "style": "enhancement",
		"build": "enhancement", "ci": "enhancement", "test": "enhancement", "chore": "enhancement",
	]

	/// One release-note line → `{type, scope?, description, sha?}`, or nil to skip.
	public static func categorize(_ raw: String) -> JSONValue? {
		let trimmed = raw.trimmingCharacters(in: .whitespaces)
		guard !trimmed.isEmpty, trimmed.wholeMatch(of: /[-*]\s*/) == nil else { return nil }
		var text = trimmed.replacing(/^\s*[-*]\s+/, with: "")
		guard !text.isEmpty else { return nil }
		let lower = text.lowercased()
		if text.firstMatch(of: /^#{1,6}\s/) != nil || lower.hasPrefix("merge pull request") || lower.hasPrefix("merge branch")
			|| lower.hasPrefix("[full diff]") || lower.hasPrefix("**full changelog**") || lower.hasPrefix("[compare")
			|| lower.hasPrefix("what's changed") || lower.hasPrefix("new contributors") {
			return nil
		}
		text = text.replacing(/(?i)\s+by\s+@[\w-]+\s+in\s+https?:\/\/\S+$/, with: "")
		guard let match = text.wholeMatch(of: /(\w+)(?:\(([^)]*)\))?:\s*(.+)/) else {
			return ["type": "enhancement", "description": .string(text)]
		}
		let type = match.1.lowercased()
		let scope = match.2.map(String.init)
		if type == "docs" || scope?.lowercased() == "docs" { return nil }
		if type == "chore", text.firstMatch(of: /(?i)^chore\(release\):\s*v/) != nil { return nil }
		guard let mapped = types[type] else { return nil }
		let rawDescription = String(match.3)
		var object: [String: JSONValue] = [
			"type": .string(mapped),
			"description": .string(rawDescription.trimmingCharacters(in: .whitespaces).replacing(/(?i)\s+\([0-9a-f]{7,40}\)\s*$/, with: "")),
		]
		if let scope { object["scope"] = .string(scope) }
		if let sha = rawDescription.firstMatch(of: /\(([0-9a-f]{7,40})\)$/) { object["sha"] = .string(String(sha.1)) }
		return .object(object)
	}

	public static func release(tag: String, url: String, publishedAt: String, body: String) -> JSONValue {
		var buckets: [String: [JSONValue]] = ["feature": [], "bug": [], "enhancement": []]
		for line in body.replacingOccurrences(of: "\r\n", with: "\n").split(separator: "\n", omittingEmptySubsequences: false) {
			if let change = categorize(String(line)), let type = change["type"]?.stringValue { buckets[type, default: []].append(change) }
		}
		return ["version": .string(tag), "tagName": .string(tag), "url": .string(url), "publishedAt": .string(publishedAt),
		        "features": .array(buckets["feature"]!), "bugs": .array(buckets["bug"]!), "enhancements": .array(buckets["enhancement"]!)]
	}

	/// `{releases: [...]}` from the GitHub releases API.
	public static func fetch(limit: Int = 10, transport: any HTTPTransport = URLSessionTransport()) async throws -> JSONValue {
		let count = min(max(limit, 1), 10)
		var request = URLRequest(url: URL(string: "https://api.github.com/repos/\(repo)/releases?per_page=\(count)")!)
		request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
		request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
		let (data, response) = try await transport.send(request)
		guard (200 ..< 300).contains(response.statusCode) else { throw TodoError.invalid("Failed to fetch changelog for \(repo): \(response.statusCode)") }
		let releases = try JSONDecoder().decode(JSONValue.self, from: data).arrayValue ?? []
		return ["releases": .array(releases.map {
			release(tag: $0["tag_name"]?.stringValue ?? "", url: $0["html_url"]?.stringValue ?? "", publishedAt: $0["published_at"]?.stringValue ?? "", body: $0["body"]?.stringValue ?? "")
		})]
	}
}
