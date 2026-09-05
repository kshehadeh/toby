import SwiftUI

struct ChatSessionsSidebar: View {
	let sessions: [SessionSummary]
	let selectedSessionId: String?
	let isLoading: Bool
	let isSessionsLoading: Bool
	let onSelectSession: (String) -> Void
	let onDeleteSession: (SessionSummary) -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			SidebarListHeader(
				title: "Chats",
				systemImage: "message",
				isSelected: selectedSessionId == nil,
			)
			.padding(.horizontal, 10)
			.padding(.top, 10)

			if isSessionsLoading && sessions.isEmpty {
				Text("Loading sessions…")
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
					.padding(.horizontal, 8)
					.padding(.vertical, 7)
			} else if sessions.isEmpty {
				Text("No past sessions")
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
					.padding(.horizontal, 8)
					.padding(.vertical, 7)
			} else {
				ScrollView {
					VStack(alignment: .leading, spacing: 2) {
						ForEach(sessions) { session in
							Button {
								onSelectSession(session.id)
							} label: {
								SidebarSessionRow(
									title: session.name,
									subtitle: sidebarSessionDate(session),
									isSelected: session.id == selectedSessionId,
									isExternal: session.isExternal,
									isAwaitingUser: session.isAwaitingUser,
									integrationIconUrl: session.integrationIconUrl,
								)
							}
							.buttonStyle(.plain)
							.frame(maxWidth: .infinity, alignment: .leading)
							.disabled(isLoading)
							.accessibilityIdentifier("session-\(session.id)")
							.contextMenu {
								Button(role: .destructive) {
									onDeleteSession(session)
								} label: {
									Label("Delete Session", systemImage: "trash")
								}
								.disabled(isLoading)
							}
						}
					}
				}
				.automaticScrollIndicators(axes: .vertical)
				.frame(maxHeight: .infinity)
			}
		}
		.background(AppTheme.sidebarBackground)
	}
}

func sidebarSessionDate(_ session: SessionSummary) -> String? {
	let raw = session.updatedAt ?? session.createdAt
	guard let raw, !raw.isEmpty else { return nil }
	let fractional = ISO8601DateFormatter()
	fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
	let date = fractional.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
	guard let date else { return nil }
	return SidebarDateFormatter.friendly.string(from: date)
}

enum SidebarDateFormatter {
	static let friendly: DateFormatter = {
		let formatter = DateFormatter()
		formatter.dateStyle = .medium
		formatter.timeStyle = .short
		return formatter
	}()
}
