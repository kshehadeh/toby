import SwiftUI

/// A left-aligned, full-width text field with a label stacked above it.
struct SkillSidebarField: View {
	let title: String
	var hint: String?
	var placeholder: String = ""
	var axis: Axis = .horizontal
	var accessibilityIdentifier: String? = nil
	@Binding var text: String

	var body: some View {
		VStack(alignment: .leading, spacing: 6) {
			HStack(spacing: 6) {
				Text(title)
					.font(.system(size: 12, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)
				if let hint {
					Text(hint)
						.font(.system(size: 11))
						.foregroundStyle(SettingsDesign.rowDescription)
				}
			}

			field
		}
	}

	@ViewBuilder
	private var field: some View {
		let textField = TextField(placeholder, text: $text, axis: axis)
			.textFieldStyle(.roundedBorder)
			.controlSize(.regular)
			.multilineTextAlignment(.leading)
			.frame(maxWidth: .infinity, alignment: .leading)
			.lineLimit(axis == .vertical ? 4 : 1)
		if let accessibilityIdentifier {
			textField.accessibilityIdentifier(accessibilityIdentifier)
		} else {
			textField
		}
	}
}
