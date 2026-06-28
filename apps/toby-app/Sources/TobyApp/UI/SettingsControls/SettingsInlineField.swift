import SwiftUI

struct SettingsInlineField: View {
	@Binding var text: String
	var isSecure = false
	var placeholder = ""

	var body: some View {
		Group {
			if isSecure {
				SecureField(placeholder, text: $text)
			} else {
				TextField(placeholder, text: $text)
			}
		}
		.textFieldStyle(.plain)
		.font(.body)
		.foregroundStyle(SettingsDesign.rowTitle)
		.multilineTextAlignment(.trailing)
		.frame(minWidth: 140, maxWidth: 220)
		.padding(.horizontal, 12)
		.padding(.vertical, 7)
		.background(
			RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
				.fill(SettingsDesign.cardBackground)
		)
		.overlay {
			RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
				.stroke(SettingsDesign.controlBorder, lineWidth: 1)
		}
	}
}
