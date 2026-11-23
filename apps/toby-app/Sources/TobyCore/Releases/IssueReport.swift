import Foundation
import TobyAI

/// Pre-filled GitHub issue links (port of `issues/github.ts`; the app has no
/// GitHub token, so it always opens the new-issue page).
public enum IssueReport {
	public static func title(type: String, details: String) -> String {
		let prefix = "[\(type)]"
		let first = details.split(separator: "\n", omittingEmptySubsequences: false).first.map { $0.trimmingCharacters(in: .whitespaces).replacing(/\s+/, with: " ") } ?? ""
		guard !first.isEmpty else { return "\(prefix) \(type.prefix(1).uppercased() + type.dropFirst()) report" }
		let available = max(10, 80 - prefix.count - 1)
		return "\(prefix) \(first.count > available ? String(first.prefix(available - 1)) + "…" : first)"
	}

	public static func body(type: String, details: String, version: String) -> String {
		let os = ProcessInfo.processInfo.operatingSystemVersion
		return [
			"## Description", "", details.trimmingCharacters(in: .whitespacesAndNewlines), "", "## Metadata", "",
			"- **Type:** \(type)", "- **Version:** \(version)", "- **Platform:** macOS \(os.majorVersion).\(os.minorVersion).\(os.patchVersion)",
			"- **Reported from:** native-app",
		].joined(separator: "\n")
	}

	/// `CreateIssueResponse` JSON with a pre-filled new-issue URL.
	public static func fallback(type: String, details: String, version: String) -> JSONValue {
		var components = URLComponents(string: "https://github.com/\(Changelog.repo)/issues/new")!
		components.queryItems = [
			URLQueryItem(name: "title", value: title(type: type, details: details)),
			URLQueryItem(name: "body", value: body(type: type, details: details, version: version)),
			URLQueryItem(name: "labels", value: type),
		]
		return ["ok": false, "fallbackUrl": .string(components.url!.absoluteString), "reason": "Opened a pre-filled issue in your browser."]
	}
}
