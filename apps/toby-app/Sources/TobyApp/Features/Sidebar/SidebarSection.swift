import SwiftUI

struct SidebarSection<Content: View>: View {
	let title: String
	@ViewBuilder let content: Content
	@Environment(\.colorScheme) private var colorScheme
	@Environment(\.tobyThemeEpoch) private var themeEpoch

	var body: some View {
		VStack(alignment: .leading, spacing: 4) {
			Text(title)
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)
				.padding(.horizontal, 8)
				.padding(.top, 10)
				.id("sidebar-section-\(title)-\(themeEpoch)-\(colorScheme)")
			content
		}
	}
}
