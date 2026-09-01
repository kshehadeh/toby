import SwiftUI

struct SkillSidebarRow: View {
	let skill: SkillListItem
	let isSelected: Bool

	var body: some View {
		HStack(spacing: 12) {
			SkillIconView(iconURL: skill.resolvedIconURL, size: 28, cornerRadius: 7)
			VStack(alignment: .leading, spacing: 2) {
				Text(skill.name)
					.font(.callout.weight(.medium))
					.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
					.lineLimit(1)
				if let description = skill.description, !description.isEmpty {
					Text(description)
						.font(.caption)
						.foregroundStyle(AppTheme.tertiaryText)
						.lineLimit(1)
				}
			}
			Spacer(minLength: 0)
		}
		.padding(.vertical, 8)
		.padding(.horizontal, 10)
		.contentShape(Rectangle())
		.background(
			RoundedRectangle(cornerRadius: 8)
				.fill(isSelected ? AppTheme.selection : Color.clear)
		)
		.accessibilityElement(children: .combine)
		.accessibilityLabel(accessibilityLabel)
		.accessibilityAddTraits(isSelected ? [.isSelected] : [])
		.accessibilityIdentifier("skill-sidebar-row-\(skill.id)")
	}

	private var accessibilityLabel: String {
		if let description = skill.description, !description.isEmpty {
			return "\(skill.name), \(description)"
		}
		return skill.name
	}
}

extension SkillListItem {
	var resolvedIconURL: URL? {
		guard let iconUrl, !iconUrl.isEmpty else { return nil }
		let base = ConfigReader.baseURL().absoluteString
		let token = (updatedAt ?? "")
			.unicodeScalars
			.filter { CharacterSet.alphanumerics.contains($0) }
			.map(String.init)
			.joined()
		let suffix = token.isEmpty ? "" : "?v=\(token)"
		return URL(string: base + iconUrl + suffix)
	}
}
