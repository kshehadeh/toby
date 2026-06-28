import SwiftUI

struct IntegrationSidebarRow: View {
	let section: SettingsItem
	let isSelected: Bool

	var body: some View {
		HStack(spacing: 12) {
			Image(systemName: "puzzlepiece.extension")
				.font(.system(size: 14, weight: .semibold))
				.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.tertiaryText)
				.frame(width: 20, height: 20)
			Text(section.label)
				.font(.callout.weight(.medium))
				.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
				.lineLimit(1)
			Spacer(minLength: 0)
		}
		.padding(.vertical, 8)
		.padding(.horizontal, 10)
		.contentShape(Rectangle())
		.background(
			RoundedRectangle(cornerRadius: 8)
				.fill(isSelected ? Color.white.opacity(0.10) : Color.clear)
		)
	}
}
