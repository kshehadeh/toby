import SwiftUI

struct ActiveChatRow: View {
	let daemonStatus: DaemonStatus?

	var body: some View {
		if let name = activeConversationName {
			HStack(spacing: 8) {
				Text("\(name) is chatting now")
					.font(.caption)
					.foregroundStyle(AppTheme.primaryText)
					.lineLimit(1)
				Spacer()
				ActivePulseIcon()
			}
		} else if let sessions = awaitingUserSessions, !sessions.isEmpty {
			VStack(alignment: .leading, spacing: 4) {
				ForEach(sessions) { session in
					HStack(spacing: 8) {
						Image(systemName: "questionmark.bubble")
							.font(.caption)
							.foregroundStyle(AppTheme.secondaryText)
						Text("\(session.displayName ?? session.externalKey) is waiting for your reply")
							.font(.caption)
							.foregroundStyle(AppTheme.secondaryText)
							.lineLimit(1)
						Spacer()
					}
				}
			}
		} else {
			HStack(spacing: 8) {
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

	private var awaitingUserSessions: [ChatInboundAwaitingSession]? {
		guard let inbound = daemonStatus?.chatInbound,
			inbound.integration?.lowercased() == "slack"
		else {
			return nil
		}
		return inbound.awaitingUserSessions
	}
}
