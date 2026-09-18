import SwiftUI

/// Trailing text control for settings rows that are not inside a grouped `Form`.
/// The visible title lives on the row; this view uses `prompt` so macOS does
/// not draw a second field label (e.g. "Enter value") beside the box.
struct SettingsInlineField: View {
	@Binding var text: String
	var isSecure = false
	var placeholder = ""
	var minWidth: CGFloat = 120
	var maxWidth: CGFloat = 220

	var body: some View {
		Group {
			if isSecure {
				SecureField(text: $text, prompt: prompt) {
					EmptyView()
				}
			} else {
				TextField(text: $text, prompt: prompt) {
					EmptyView()
				}
			}
		}
		.labelsHidden()
		.textFieldStyle(.roundedBorder)
		.multilineTextAlignment(.leading)
		.frame(minWidth: minWidth, maxWidth: maxWidth)
		.controlSize(.regular)
	}

	private var prompt: Text? {
		placeholder.isEmpty ? nil : Text(placeholder)
	}
}
