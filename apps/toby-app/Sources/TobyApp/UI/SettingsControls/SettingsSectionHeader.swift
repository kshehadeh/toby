import SwiftUI

struct SettingsSectionHeader: View {
	let title: String

	var body: some View {
		Text(title)
			.font(.subheadline.weight(.medium))
			.foregroundStyle(SettingsDesign.sectionHeader)
			.frame(maxWidth: .infinity, alignment: .leading)
			.padding(.leading, 4)
			.padding(.bottom, 6)
	}
}
