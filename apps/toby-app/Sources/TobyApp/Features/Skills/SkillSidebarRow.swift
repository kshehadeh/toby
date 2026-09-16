import SwiftUI

struct SkillSidebarRow: View {
	let skill: SkillListItem
	let isSelected: Bool

	var body: some View {
		FeatureBrowserRow(
			title: skill.name,
			subtitle: skill.summary.isEmpty ? nil : skill.summary,
			isSelected: isSelected,
			accessibilityIdentifier: "skill-sidebar-row-\(skill.id)"
		) {
			SkillIconView(iconURL: skill.resolvedIconURL, size: 28, cornerRadius: 7)
		}
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
