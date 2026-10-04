import SwiftUI

/// A secret in a grouped settings form. Once a value is saved it reads
/// "✓ Saved" with a Change… button instead of a field full of dots and a
/// "value is saved" sentence; Change… opens an empty secure field.
struct SettingsSecretFieldRow: View {
	let label: String
	var placeholder: String? = nil
	let hasSavedValue: Bool
	@Binding var text: String

	@State private var isEditing = false
	@FocusState private var isFocused: Bool

	var body: some View {
		if hasSavedValue && !isEditing {
			LabeledContent(label) {
				HStack(spacing: 10) {
					HStack(spacing: 5) {
						Image(systemName: "checkmark.circle.fill")
							.foregroundStyle(.green)
							.accessibilityHidden(true)
						Text("Saved")
							.foregroundStyle(.secondary)
					}
					Button("Change…") {
						isEditing = true
						isFocused = true
					}
					.accessibilityLabel("Change \(label)")
				}
			}
			.accessibilityIdentifier("settings-secret-saved")
		} else if hasSavedValue {
			LabeledContent(label) {
				HStack(spacing: 8) {
					SecureField(label, text: $text, prompt: Text("Paste a new value"))
						.labelsHidden()
						.textFieldStyle(.roundedBorder)
						.frame(maxWidth: 260)
						.focused($isFocused)
						.onSubmit { isEditing = false }
					Button("Done") { isEditing = false }
				}
			}
			.accessibilityIdentifier("settings-secret-editing")
		} else {
			SecureField(label, text: $text, prompt: Text(placeholder ?? ""))
				.focused($isFocused)
				.accessibilityIdentifier("settings-secret-field")
		}
	}
}
