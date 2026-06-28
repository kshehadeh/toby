import SwiftUI

struct RecordingNameEditor: View {
	@Binding var draft: String
	var isFocused: FocusState<Bool>.Binding
	let onSave: () -> Void
	let onCancel: () -> Void

	var body: some View {
		HStack(spacing: 8) {
			TextField("Recording name", text: $draft)
				.textFieldStyle(.roundedBorder)
				.focused(isFocused)
				.onSubmit(onSave)
				.accessibilityIdentifier("recording-name-field")

			Button("Save", systemImage: "checkmark") {
				onSave()
			}
			.buttonStyle(.borderedProminent)
			.accessibilityIdentifier("save-recording-name-button")

			Button("Cancel", systemImage: "xmark") {
				onCancel()
			}
			.buttonStyle(.bordered)
			.accessibilityIdentifier("cancel-recording-name-button")
		}
	}
}
