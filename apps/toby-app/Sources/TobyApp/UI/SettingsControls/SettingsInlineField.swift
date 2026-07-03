import SwiftUI

struct SettingsInlineField: View {
	@Binding var text: String
	var isSecure = false
	var placeholder = ""
	var minWidth: CGFloat = 120
	var maxWidth: CGFloat = 220

	var body: some View {
		Group {
			if isSecure {
				SecureField(placeholder, text: $text)
			} else {
				TextField(placeholder, text: $text)
			}
		}
		.textFieldStyle(.roundedBorder)
		.multilineTextAlignment(.leading)
		.frame(minWidth: minWidth, maxWidth: maxWidth)
		.controlSize(.regular)
	}
}
