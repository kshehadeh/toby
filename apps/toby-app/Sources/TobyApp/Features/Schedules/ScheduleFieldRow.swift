import SwiftUI

struct ScheduleFieldRow<Control: View>: View {
	let title: String
	var description: String?
	var descriptionView: AnyView?
	var error: String?
	var showsDivider: Bool = true
	@ViewBuilder let control: Control

	var body: some View {
		VStack(spacing: 0) {
			HStack(alignment: .center, spacing: 16) {
				VStack(alignment: .leading, spacing: 4) {
					Text(title)
						.font(.body)
						.foregroundStyle(SettingsDesign.rowTitle)
					if let descriptionView {
						descriptionView
					} else if let description, !description.isEmpty {
						Text(description)
							.font(.subheadline)
							.foregroundStyle(SettingsDesign.rowDescription)
							.fixedSize(horizontal: false, vertical: true)
					}
					if let error, !error.isEmpty {
						Text(error)
							.font(.subheadline)
							.foregroundStyle(.red)
							.fixedSize(horizontal: false, vertical: true)
					}
				}
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
