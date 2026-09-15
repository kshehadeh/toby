import Foundation

extension DashboardBlockContent {
	var resolvedSections: [DashboardBlockContentSection]? {
		if let sections, !sections.isEmpty {
			return sections
		}
		return DashboardContentSectionParser.parse(text)
	}
}

enum DashboardContentSectionParser {
	private struct Draft {
		var eyebrow: String?
		var title: String?
		var bodyLines: [String] = []
		var items: [DashboardBlockContentItem] = []

		var hasContent: Bool {
			eyebrow != nil || title != nil || bodyLines.contains { !$0.isEmpty } || !items.isEmpty
		}
	}

	static func parse(_ markdown: String) -> [DashboardBlockContentSection]? {
		guard !markdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
			return nil
		}
		var sections: [DashboardBlockContentSection] = []
		var draft = Draft()
		var foundStructure = false

		func flush() {
			guard draft.hasContent else { return }
			let body = draft.bodyLines.joined(separator: "\n")
				.trimmingCharacters(in: .whitespacesAndNewlines)
			sections.append(
				DashboardBlockContentSection(
					id: "section-\(sections.count)",
					eyebrow: draft.eyebrow,
					title: draft.title,
					body: body.isEmpty ? nil : body,
					items: draft.items
				)
			)
			draft = Draft()
		}

		for rawLine in markdown.components(separatedBy: .newlines) {
			let line = rawLine.trimmingCharacters(in: .whitespaces)
			if let heading = heading(line) {
				foundStructure = true
				if heading.level == 2 {
					flush()
					draft.eyebrow = plainInline(heading.text)
				} else if draft.title == nil {
					draft.title = plainInline(heading.text)
				} else {
					flush()
					draft.title = plainInline(heading.text)
				}
			} else if let itemText = listItem(line) {
				foundStructure = true
				draft.items.append(item(itemText))
			} else {
				draft.bodyLines.append(rawLine)
			}
		}
		flush()
		return foundStructure && !sections.isEmpty ? sections : nil
	}

	private static func heading(_ line: String) -> (level: Int, text: String)? {
		for level in stride(from: 3, through: 1, by: -1) {
			let prefix = String(repeating: "#", count: level) + " "
			if line.hasPrefix(prefix) {
				return (level, String(line.dropFirst(prefix.count)))
			}
		}
		return nil
	}

	private static func listItem(_ line: String) -> String? {
		for prefix in ["- ", "* ", "• "] where line.hasPrefix(prefix) {
			return String(line.dropFirst(prefix.count))
		}
		return nil
	}

	private static func item(_ raw: String) -> DashboardBlockContentItem {
		let link = markdownLink(raw)
		if let lead = emphasizedLead(raw) {
			return DashboardBlockContentItem(
				title: lead.title,
				subtitle: lead.subtitle,
				url: link?.url
			)
		}
		let plain = plainInline(raw)
		let parts = splitSubtitle(plain)
		return DashboardBlockContentItem(
			title: parts.title,
			subtitle: parts.subtitle,
			url: link?.url
		)
	}

	private static func emphasizedLead(_ raw: String) -> (title: String, subtitle: String?)? {
		guard raw.hasPrefix("**"),
			let close = raw.dropFirst(2).range(of: "**")
		else { return nil }
		let titleStart = raw.index(raw.startIndex, offsetBy: 2)
		let title = String(raw[titleStart..<close.lowerBound])
			.trimmingCharacters(in: CharacterSet(charactersIn: ":").union(.whitespaces))
		let remainder = String(raw[close.upperBound...])
			.trimmingCharacters(
				in: CharacterSet(charactersIn: ":—–-").union(.whitespaces)
			)
		return (title, remainder.isEmpty ? nil : plainInline(remainder))
	}

	private static func markdownLink(_ raw: String) -> (label: String, url: String)? {
		guard let open = raw.firstIndex(of: "["),
			let close = raw[open...].firstIndex(of: "]"),
			raw.index(after: close) < raw.endIndex,
			raw[raw.index(after: close)] == "(",
			let end = raw[raw.index(close, offsetBy: 2)...].firstIndex(of: ")")
		else { return nil }
		let label = String(raw[raw.index(after: open)..<close])
		let urlStart = raw.index(close, offsetBy: 2)
		return (label, String(raw[urlStart..<end]))
	}

	private static func plainInline(_ raw: String) -> String {
		var value = raw
		while let link = markdownLink(value),
			let range = value.range(of: "[\(link.label)](\(link.url))")
		{
			value.replaceSubrange(range, with: link.label)
		}
		return value
			.replacingOccurrences(of: "**", with: "")
			.replacingOccurrences(of: "__", with: "")
			.replacingOccurrences(of: "`", with: "")
			.replacingOccurrences(of: "*", with: "")
			.trimmingCharacters(in: .whitespacesAndNewlines)
	}

	private static func splitSubtitle(_ value: String) -> (title: String, subtitle: String?) {
		for separator in [" — ", " – "] {
			if let range = value.range(of: separator) {
				let title = String(value[..<range.lowerBound]).trimmingCharacters(in: .whitespaces)
				let subtitle = String(value[range.upperBound...]).trimmingCharacters(in: .whitespaces)
				return (title, subtitle.isEmpty ? nil : subtitle)
			}
		}
		return (value, nil)
	}
}
