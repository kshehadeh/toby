import SwiftUI

struct SkillFieldRow<Control: View>: View {
	let title: String
	var showsDivider: Bool = true
	@ViewBuilder let control: Control

	var body: some View {
		VStack(spacing: 0) {
			HStack(alignment: .center, spacing: 16) {
				Text(title)
					.font(.body)
					.foregroundStyle(SettingsDesign.rowTitle)
					.frame(maxWidth: .infinity, alignment: .leading)

				control
					.layoutPriority(1)
			}
			.padding(.horizontal, SettingsDesign.rowHorizontalPadding)
			.padding(.vertical, SettingsDesign.rowVerticalPadding)

			if showsDivider {
				Rectangle()
					.fill(SettingsDesign.cardBorder)
					.frame(height: 1)
					.padding(.leading, SettingsDesign.rowHorizontalPadding)
			}
		}
	}
}
