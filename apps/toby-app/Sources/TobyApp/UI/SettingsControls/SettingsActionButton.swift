import SwiftUI

struct SettingsActionButton: View {
	let title: String
	var showsExternalIcon = false
	let action: () -> Void

	var body: some View {
		Button(action: action) {
			if showsExternalIcon {
				Label(title, systemImage: "arrow.up.right.square")
			} else {
				Text(title)
			}
		}
		.buttonStyle(.bordered)
		.controlSize(.regular)
	}
}
