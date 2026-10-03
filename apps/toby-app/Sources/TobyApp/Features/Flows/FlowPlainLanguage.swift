import Foundation

/// Plain-language wording for the Flows overview, so people who never built a
/// flow can read what one does without node types, tool ids or output keys.
/// The technical names stay available in the pane's "Technical details".

enum FlowStoryPhase: Equatable {
	case gathers
	case thinks
	case shares

	var label: String {
		switch self {
		case .gathers: return "Gathers And Acts"
		case .thinks: return "Thinks"
		case .shares: return "Shares"
		}
	}
}

enum FlowStoryTint: Equatable {
	case neutral
	case accent
}

/// One row of the "How it works" story: a step or a destination.
struct FlowStoryRow: Identifiable, Equatable {
	let id: String
	let phase: FlowStoryPhase
	/// Set on the first row of each run of the same phase.
	let startsPhase: Bool
	let title: String
	let subtitle: String?
	let systemImage: String
	let iconURL: URL?
	let tint: FlowStoryTint
}

enum FlowStory {
	static func rows(for flow: FlowListItem) -> [FlowStoryRow] {
		var drafts: [(id: String, phase: FlowStoryPhase, title: String, subtitle: String?, systemImage: String, iconURL: URL?, tint: FlowStoryTint)] = []

		for node in flow.nodes {
			if node.type == "llm_prompter" {
				drafts.append((
					id: "node-\(node.id)",
					phase: .thinks,
					title: "Asks AI to put it together",
					subtitle: "Using the steps above, with \(flow.plainPersonaPhrase)",
					systemImage: "sparkles",
					iconURL: nil,
					tint: .accent
				))
			} else {
				drafts.append((
					id: "node-\(node.id)",
					phase: .gathers,
					title: node.plainTitle,
					subtitle: node.plainSubtitle,
					systemImage: node.plainSystemImage,
					iconURL: node.integrationIconURL,
					tint: .neutral
				))
			}
		}

		for (index, destination) in (flow.destinations ?? []).enumerated() {
			drafts.append((
				id: "destination-\(index)",
				phase: .shares,
				title: destination.plainTitle,
				subtitle: destination.plainSubtitle,
				systemImage: destination.plainSystemImage,
				iconURL: nil,
				tint: .neutral
			))
		}

		var previous: FlowStoryPhase?
		return drafts.map { draft in
			let startsPhase = draft.phase != previous
			previous = draft.phase
			return FlowStoryRow(
				id: draft.id,
				phase: draft.phase,
				startsPhase: startsPhase,
				title: draft.title,
				subtitle: draft.subtitle,
				systemImage: draft.systemImage,
				iconURL: draft.iconURL,
				tint: draft.tint
			)
		}
	}

	/// Category ("email", "tasks", "calendar") for a standard tool id such as
	/// `calendar.upcomingSummary`.
	static func category(forStandardTool standardTool: String) -> String? {
		guard let prefix = standardTool.split(separator: ".").first else { return nil }
		let category = String(prefix)
		return ["email", "tasks", "calendar"].contains(category) ? category : nil
	}

	static func title(forStandardTool standardTool: String) -> String {
		switch standardTool {
		case "email.unreadSummary": return "Unread email"
		case "tasks.openSummary": return "Open tasks"
		case "calendar.upcomingSummary": return "Upcoming events"
		default:
			let name = standardTool.split(separator: ".").last.map(String.init) ?? standardTool
			return ToolDisplayLabels.displayLabel(name)
		}
	}

	static func source(forCategory category: String) -> String {
		switch category {
		case "email": return "From your email"
		case "tasks": return "From your task list"
		case "calendar": return "From your calendar"
		default: return "From your \(category)"
		}
	}

	static func systemImage(forCategory category: String) -> String? {
		switch category {
		case "email": return "envelope"
		case "tasks": return "checklist"
		case "calendar": return "calendar"
		default: return nil
		}
	}
}

extension FlowNodeSnapshot {
	private var standardCategory: String? {
		if let category = display?.category, !category.isEmpty { return category }
		if let standardTool = tool?.standardTool { return FlowStory.category(forStandardTool: standardTool) }
		return nil
	}

	/// What the step gets, e.g. "Open tasks summary" or "Upcoming events".
	var plainTitle: String {
		if let title = display?.title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty {
			return title
		}
		guard let tool else { return typeLabel }
		if tool.userToolId != nil {
			return tool.displayName ?? "Script tool"
		}
		if let standardTool = tool.standardTool, !standardTool.isEmpty {
			return FlowStory.title(forStandardTool: standardTool)
		}
		if let toolName = tool.toolName, !toolName.isEmpty {
			return ToolDisplayLabels.displayLabel(toolName)
		}
		return typeLabel
	}

	/// Where the step gets it from, e.g. "From Todoist" or "From your calendar".
	var plainSubtitle: String? {
		if let name = display?.integrationDisplayName, !name.isEmpty {
			return "From \(name)"
		}
		if let category = standardCategory {
			return FlowStory.source(forCategory: category)
		}
		if tool?.userToolId != nil {
			return "Your script tool"
		}
		if let moduleName = tool?.moduleName, !moduleName.isEmpty {
			return "From \(moduleName.capitalized)"
		}
		return nil
	}

	/// SF Symbol shown when the integration has no icon (or it is loading).
	var plainSystemImage: String {
		if type == "llm_prompter" { return "sparkles" }
		if tool?.userToolId != nil { return "curlybraces" }
		if let category = standardCategory, let symbol = FlowStory.systemImage(forCategory: category) {
			return symbol
		}
		return ToolDisplayLabels.iconForTool(tool?.toolName ?? tool?.standardTool ?? "")
	}

	var integrationIconURL: URL? {
		guard let path = display?.integrationIconUrl, !path.isEmpty else { return nil }
		if path.hasPrefix("http://") || path.hasPrefix("https://") {
			return URL(string: path)
		}
		return URL(string: ConfigReader.baseURL().absoluteString + path)
	}
}

extension FlowDestinationSpec {
	var plainTitle: String {
		switch type {
		case "modal":
			return "Shows the result in a window"
		case "email":
			return "Emails the result"
		case "slack":
			return "Posts the result to Slack"
		case "dashboard":
			return variant == "runner" ? "Adds an Actions tile on Home" : "Shows the result as a card on Home"
		default:
			return "Sends the result to \(type.capitalized)"
		}
	}

	var plainSubtitle: String? {
		switch type {
		case "email":
			let recipients = (to ?? []).joined(separator: ", ")
			return recipients.isEmpty ? nil : "To \(recipients)"
		case "slack":
			guard let channel, !channel.isEmpty else { return nil }
			return "In \(channel)"
		case "dashboard":
			if variant == "runner" { return "Runs when you click it" }
			return refresh == "manual" ? "Refreshes when you ask" : "Refreshes on its own"
		default:
			return nil
		}
	}

	var plainSystemImage: String {
		switch type {
		case "modal": return "macwindow"
		case "email": return "envelope"
		case "slack": return "number"
		case "dashboard": return "house"
		default: return "paperplane"
		}
	}
}

extension FlowListItem {
	/// "Toby's default persona", "your dashboard persona" or "the Ada persona".
	var plainPersonaPhrase: String {
		guard let persona else { return "Toby’s default persona" }
		switch persona.source {
		case "named":
			if let name = persona.name, !name.isEmpty { return "the \(name) persona" }
			return "a named persona"
		case "dashboard":
			return "your dashboard persona"
		default:
			return "Toby’s default persona"
		}
	}

	/// The flow's description, or a short fallback when it has none.
	var overviewSummary: String {
		if let description, !description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
			return description
		}
		switch nodes.count {
		case 0: return "This flow has no steps yet."
		case 1: return "Runs one step."
		default: return "Runs \(nodes.count) steps in order."
		}
	}

	var updatedLabel: String? {
		guard let updatedAt, let date = FlowISO8601.date(from: updatedAt) else { return nil }
		return DateFormatter.localizedString(from: date, dateStyle: .medium, timeStyle: .short)
	}
}
