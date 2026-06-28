import SwiftUI

struct SlackStatusRow: View {
	let status: AppStatus?
	let daemonStatus: DaemonStatus?

	var body: some View {
		HStack(spacing: 8) {
			Text("Slack")
				.font(.caption)
				.foregroundStyle(AppTheme.primaryText)
			Spacer()
			if isConnected {
				HStack(spacing: 4) {
					Circle()
						.fill(Color.green)
						.frame(width: 6, height: 6)
					Text("Connected")
						.font(.caption)
						.foregroundStyle(AppTheme.secondaryText)
				}
				.padding(.horizontal, 6)
				.padding(.vertical, 2)
				.background(
					Capsule()
						.fill(Color.green.opacity(0.15))
				)
				.overlay(
					Capsule()
						.stroke(Color.green.opacity(0.35), lineWidth: 1)
				)
			} else {
				Text("Not connected")
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
			}
		}
	}

	private var isConnected: Bool {
		guard let status else { return false }
		return status.connectedIntegrations?.contains(where: { $0.lowercased() == "slack" }) == true
	}
}
