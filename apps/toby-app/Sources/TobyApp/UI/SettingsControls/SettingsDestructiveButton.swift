import SwiftUI

struct SettingsDestructiveButton: View {
	let title: String
	let action: () -> Void

	var body: some View {
		Button(title, role: .destructive, action: action)
			.buttonStyle(.plain)
			.font(.body)
			.foregroundStyle(.red.opacity(0.85))
			.padding(.horizontal, 12)
			.padding(.vertical, 7)
			.background(
				RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
					.fill(Color.red.opacity(0.08))
			)
			.overlay {
				RoundedRectangle(cornerRadius: SettingsDesign.controlCornerRadius)
					.stroke(Color.red.opacity(0.22), lineWidth: 1)
			}
	}
}
