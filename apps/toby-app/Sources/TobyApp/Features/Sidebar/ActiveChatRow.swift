import SwiftUI

struct ActiveChatRow: View {
	let daemonStatus: DaemonStatus?

	var body: some View {
		HStack(spacing: 8) {
			if let name = activeConversationName {
				Text("\(name) is chatting now")
					.font(.caption)
					.foregroundStyle(AppTheme.primaryText)
					.lineLimit(1)
				Spacer()
				ActivePulseIcon()
			} else {
				Text("No active Slack chat")
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
				Spacer()
			}
		}
	}

	private var activeConversationName: String? {
		guard let inbound = daemonStatus?.chatInbound,
			inbound.integration?.lowercased() == "slack",
			inbound.isActive
		else {
			return nil
		}
		return inbound.activeConversationName
	}
}
