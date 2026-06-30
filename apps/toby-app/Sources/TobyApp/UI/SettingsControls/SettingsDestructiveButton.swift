import SwiftUI

struct SettingsDestructiveButton: View {
	let title: String
	let action: () -> Void

	var body: some View {
		Button(title, role: .destructive, action: action)
			.buttonStyle(.bordered)
			.controlSize(.regular)
	}
}
