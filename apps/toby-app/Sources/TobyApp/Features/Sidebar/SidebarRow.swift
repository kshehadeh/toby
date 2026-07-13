import SwiftUI

struct SidebarRow: View {
	let title: String
	let systemImage: String
	var isSelected = false
	@Environment(\.colorScheme) private var colorScheme
	@Environment(\.tobyThemeEpoch) private var themeEpoch

	var body: some View {
		Label(title, systemImage: systemImage)
			.font(.callout)
			.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
			.lineLimit(1)
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(.horizontal, 8)
			.padding(.vertical, 7)
			.contentShape(Rectangle())
			.background(
				RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
					.fill(isSelected ? AppTheme.selection : Color.clear)
			)
			.id("sidebar-row-\(title)-\(themeEpoch)-\(colorScheme)")
	}
}
