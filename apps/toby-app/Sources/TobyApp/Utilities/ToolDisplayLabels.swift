import Foundation

enum ToolDisplayLabels {
	private static let overrides: [String: String] = [
		"askUser": "Ask you to choose",
		"getInboxUnreadOverview": "Fetch inbox overview",
		"getUnreadEmailMetadataBatch": "Fetch email metadata",
		"archiveEmailById": "Archive email by ID",
		"markAsReadById": "Mark email as read",
		"applyMultipleLabelsByMessageId": "Apply labels to email by ID",
		"listLabels": "List Gmail labels",
		"createAndApplyLabel": "Create and apply label",
		"applyMultipleLabels": "Apply multiple labels",
		"markAsRead": "Mark current email as read",
		"archiveEmail": "Archive current email",
		"getRecentEmails": "Fetch recent unread emails",
		"fetchOpenTasks": "Fetch open Todoist tasks",
		"fetchCompletedTasks": "Fetch completed Todoist tasks",
		"listProjectNames": "List Todoist project names",
		"getProjectNameById": "Resolve Todoist project name",
		"completeTask": "Complete Todoist task",
		"createTask": "Create Todoist task",
		"updateTask": "Update Todoist task",
		"listUsers": "List Azure AD users",
		"searchUsers": "Search Azure AD users",
		"getUser": "Get Azure AD user",
		"getUserManager": "Get user manager",
		"getUserDirectReports": "Get direct reports",
		"createLocalSkill": "Create local Toby skill",
		"memorySearch": "Search memory",
		"memoryPropose": "Propose memory",
		"memorySave": "Save memory",
		"memoryForget": "Forget memory",
		"memoryExplain": "Explain memory",
		"memoryRetrieveForTask": "Retrieve memories for task",
		"listListenRecordings": "List listen recordings",
		"readTranscript": "Read listen transcript",
	]

	static func displayLabel(_ toolName: String) -> String {
		if let override = overrides[toolName] {
			return override
		}
		return humanize(toolName)
	}

	private static func humanize(_ toolName: String) -> String {
		let tokenized = toolName
			.replacingOccurrences(of: "_", with: " ")
			.replacingOccurrences(
				of: "([a-z0-9])([A-Z])",
				with: "$1 $2",
				options: .regularExpression
			)
			.trimmingCharacters(in: .whitespacesAndNewlines)
			.split(separator: " ")
			.filter { !$0.isEmpty }

		guard !tokenized.isEmpty else { return toolName }

		return tokenized.enumerated().map { index, part in
			let lower = part.lowercased()
			if lower == "id" { return "ID" }
			if index == 0 {
				return lower.prefix(1).uppercased() + lower.dropFirst()
			}
			return lower
		}.joined(separator: " ")
	}

	static func formatToolOutput(
		toolName: String,
		args: [String: Any]?,
		result: Any?,
		error: String?
	) -> String {
		if let error, !error.isEmpty {
			return sanitizeOneLine("Failed: \(error)", maxLen: 200)
		}

		guard let result else { return "Done." }

		if let array = result as? [Any] {
			return "Returned \(array.count) item(s)."
		}

		if let str = result as? String {
			return sanitizeOneLine(str, maxLen: 200)
		}

		if let num = result as? Double {
			if num == num.rounded() && abs(num) < 1e15 {
				return String(Int(num))
			}
			return String(num)
		}

		if let bool = result as? Bool {
			return bool ? "Done." : "No result."
		}

		if let dict = result as? [String: Any] {
			if let err = dict["error"] as? String, !err.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
				return sanitizeOneLine("Error: \(err)", maxLen: 200)
			}
			for key in ["events", "calendars", "items", "results", "data", "tasks", "emails", "users", "labels", "files", "contacts", "messages", "notes", "records", "entries"] {
				if let array = dict[key] as? [Any] {
					let singular = key.hasSuffix("s") ? String(key.dropLast()) : key
					return array.isEmpty ? "No \(key) found." : "Found \(array.count) \(singular)(s)."
				}
			}
			for key in ["message", "summary", "text", "content", "description", "name", "title", "subject"] {
				if let val = dict[key] as? String, !val.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
					return sanitizeOneLine(val, maxLen: 200)
				}
			}
			if let success = dict["success"] as? Bool, success {
				return "Done."
			}
		}

		return "Done."
	}

	private static func sanitizeOneLine(_ value: String, maxLen: Int = 200) -> String {
		value.replacingOccurrences(of: "\r", with: " ")
			.replacingOccurrences(of: "\n", with: " ")
			.trimmingCharacters(in: .whitespacesAndNewlines)
			.prefix(maxLen)
			.trimmingCharacters(in: .whitespacesAndNewlines)
	}

	static func formatToolCallHeader(
		toolName: String,
		args: [String: Any]?,
		integrationLabel: String?
	) -> String {
		let label = displayLabel(toolName)
		let prefix = integrationLabel.map { "\($0): " } ?? ""
		return "\(prefix)\(label)\(summarizeArgsForHeader(toolName: toolName, args: args))"
	}

	private static func summarizeArgsForHeader(
		toolName: String,
		args: [String: Any]?
	) -> String {
		guard toolName != "askUser", let args else { return "" }

		if let id = args["id"] as? String, !id.isEmpty {
			return " · \(truncate(id, maxLen: 28))"
		}
		if let id = args["messageId"] as? String, !id.isEmpty {
			return " · \(truncate(id, maxLen: 28))"
		}
		if let id = args["taskId"] as? String, !id.isEmpty {
			return " · \(truncate(id, maxLen: 28))"
		}
		if let id = args["userId"] as? String, !id.isEmpty {
			return " · \(truncate(id, maxLen: 28))"
		}

		let q = (args["query"] as? String ?? args["q"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		if !q.isEmpty {
			return " · “\(truncate(q, maxLen: 36))”"
		}

		return ""
	}

	private static func truncate(_ value: String, maxLen: Int) -> String {
		value.count <= maxLen ? value : "\(value.prefix(maxLen - 1))…"
	}

	// MARK: - Tool icons

	/// Returns an SF Symbol name representing the category of a tool.
	static func iconForTool(_ toolName: String) -> String {
		// Explicit per-tool overrides
		if let icon = toolIconOverrides[toolName] {
			return icon
		}

		// Pattern-based matching (order matters: more specific patterns first)
		let lower = toolName.lowercased()

		if lower.contains("memory") {
			return "brain.head.profile"
		}
		if lower.contains("calendar") || lower.contains("event") {
			return "calendar"
		}
		if lower.contains("email") || lower.contains("inbox") || lower.contains("mail") {
			return "envelope"
		}
		if lower.contains("task") || lower.contains("todoist") || lower.contains("project") {
			return "checklist"
		}
		if lower.contains("slack") || lower.contains("channel") || lower.contains("post") {
			return "bubble.left"
		}
		if lower.contains("user") || lower.contains("people") || lower.contains("directory") {
			return "person.2"
		}
		if lower.contains("listen") || lower.contains("recording") || lower.contains("transcript") {
			return "waveform"
		}
		if lower.contains("websearch") || lower.contains("search") && !lower.contains("user") {
			return "magnifyingglass"
		}
		if lower.contains("fetchweb") || lower.contains("web") && lower.contains("fetch") {
			return "globe"
		}
		if lower.contains("skill") {
			return "wand.and.stars"
		}
		if lower.contains("integration") {
			return "puzzlepiece"
		}
		if lower.contains("file") || lower.contains("write") {
			return "doc"
		}
		if lower.contains("askuser") {
			return "questionmark.bubble"
		}
		if lower.contains("datetime") || lower.contains("time") {
			return "clock"
		}
		if lower.hasPrefix("toby") {
			return "sparkles"
		}

		return "wrench.and.screwdriver"
	}

	private static let toolIconOverrides: [String: String] = [
		"askUser": "questionmark.bubble",
		"webSearch": "magnifyingglass",
		"fetchWebContent": "globe",
		"getCurrentDateTime": "clock",
		"writeTextFile": "doc",
		"createLocalSkill": "wand.and.stars",
		"loadLocalSkillInstructions": "book",
		"createDraft": "envelope",
		"listLabels": "tag",
		"createAndApplyLabel": "tag",
		"applyMultipleLabels": "tag",
		"applyMultipleLabelsByMessageId": "tag",
		"batchModifyMessages": "envelope",
		"postToChannel": "bubble.left",
		"replyToPost": "bubble.left",
		"searchChannels": "bubble.left",
		"searchMessages": "bubble.left",
		"tobyListIntegrations": "puzzlepiece",
		"tobyGetIntegrationSetup": "puzzlepiece",
		"tobyListDefaults": "sparkles",
		"tobyListTools": "wrench.and.screwdriver",
		"tobyListSkills": "wand.and.stars",
		"tobyInstanceInfo": "info.circle",
	]
}
