import SwiftUI

struct IntegrationSidebarRow: View {
	let section: SettingsItem
	let isSelected: Bool

	private var iconUrl: URL? {
		guard let iconUrl = section.iconUrl else { return nil }
		return URL(string: ConfigReader.baseURL().absoluteString + iconUrl)
	}

	var body: some View {
		HStack(spacing: 12) {
			iconView
				.frame(width: 20, height: 20)
			Text(section.label)
				.font(.callout.weight(.medium))
				.foregroundStyle(AppTheme.primaryText)
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

	@ViewBuilder
	private var iconView: some View {
		if let iconUrl {
			SidebarIconView(url: iconUrl, fallbackSystemName: "puzzlepiece.extension", isSelected: true)
				.frame(width: 16, height: 16)
		} else if let icon = section.icon, !icon.isEmpty {
			Text(icon)
				.font(.system(size: 14))
		} else {
			Image(systemName: "puzzlepiece.extension")
				.font(.system(size: 14, weight: .semibold))
				.foregroundStyle(AppTheme.primaryText)
		}
	}
}
