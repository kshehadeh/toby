import SwiftUI

struct SettingsSelectChoiceField: View {
	let title: String
	let choices: [SettingsSelectChoice]
	@Binding var selection: String
	var minWidth: CGFloat = 120
	var maxWidth: CGFloat = 240

	var body: some View {
		Picker(title, selection: $selection) {
			ForEach(choices, id: \.value) { choice in
				Text(choice.label).tag(choice.value)
			}
		}
		.labelsHidden()
		.pickerStyle(.menu)
		.controlSize(.regular)
		.frame(minWidth: minWidth, maxWidth: maxWidth)
	}
}

