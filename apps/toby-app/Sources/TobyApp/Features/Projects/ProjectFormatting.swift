import Foundation

func projectChatCountLabel(_ count: Int) -> String {
	count == 1 ? "1 chat" : "\(count) chats"
}

func projectPersonaLabel(personaName: String?, options: [PersonaOption]) -> String {
	guard let personaName, !personaName.isEmpty else { return "Default" }
	return options.first(where: { $0.name == personaName })?.label ?? personaName
}

func projectMetaLine(
	chatCount: Int,
	personaName: String?,
	options: [PersonaOption],
) -> String {
	"\(projectChatCountLabel(chatCount)) · \(projectPersonaLabel(personaName: personaName, options: options))"
}

/// First non-empty paragraph of a project summary (text up to the first blank line).
func projectSummaryFirstParagraph(_ text: String) -> String {
	let normalized = text
		.replacingOccurrences(of: "\r\n", with: "\n")
		.replacingOccurrences(of: "\r", with: "\n")
	let trimmed = normalized.trimmingCharacters(in: .whitespacesAndNewlines)
	guard !trimmed.isEmpty else { return "" }
	guard let blankLine = trimmed.range(of: #"\n[ \t]*\n"#, options: .regularExpression) else {
		return trimmed
	}
	return String(trimmed[..<blankLine.lowerBound])
		.trimmingCharacters(in: .whitespacesAndNewlines)
}
