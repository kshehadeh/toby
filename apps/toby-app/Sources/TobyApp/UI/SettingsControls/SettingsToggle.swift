import SwiftUI

struct SettingsToggle: View {
	@Binding var isOn: Bool

	var body: some View {
		Toggle("", isOn: $isOn)
			.labelsHidden()
			.toggleStyle(.switch)
			.tint(SettingsDesign.toggleTint)
	}
}
