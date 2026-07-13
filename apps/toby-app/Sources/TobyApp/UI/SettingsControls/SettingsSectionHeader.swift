import SwiftUI

struct SettingsSectionHeader: View {
	let title: String
	/// Depend on scheme so group/section labels re-tint when appearance changes.
	@Environment(\.colorScheme) private var colorScheme
	@Environment(\.tobyThemeEpoch) private var themeEpoch

	var body: some View {
		Text(title)
			.font(.subheadline.weight(.medium))
			.foregroundStyle(SettingsDesign.sectionHeader)
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(.leading, 4)
			.padding(.bottom, 6)
			// Tie body invalidation to theme without remounting parent state.
			.id("section-header-\(title)-\(themeEpoch)-\(colorScheme)")
	}
}
