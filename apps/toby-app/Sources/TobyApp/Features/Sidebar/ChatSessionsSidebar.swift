import SwiftUI

struct ChatSessionsSidebar: View {
	let sessions: [SessionSummary]
	let selectedSessionId: String?
	let isLoading: Bool
	let isSessionsLoading: Bool
	let onSelectSession: (String) -> Void
	let onDeleteSession: (SessionSummary) -> Void
	@State private var isWorkspaceScrolling = false
	@State private var workspaceScrollProgress: CGFloat = 0
	@State private var chatsHeight: CGFloat = 220

	var body: some View {
		SidebarSection(title: "Chats") {
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
				ZStack(alignment: .trailing) {
					ScrollView(.vertical, showsIndicators: false) {
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
							ScrollStateTracker(
								isScrolling: $isWorkspaceScrolling,
								progress: $workspaceScrollProgress
							)
							.frame(width: 0, height: 0)
						}
					}

					if isWorkspaceScrolling {
						Rectangle()
							.fill(AppTheme.tertiaryText.opacity(0.6))
							.frame(width: 3, height: 40)
							.cornerRadius(1.5)
							.padding(.trailing, 2)
							.offset(y: (workspaceScrollProgress - 0.5) * (chatsHeight - 40))
							.transition(.opacity)
							.allowsHitTesting(false)
					}
				}
				.frame(maxHeight: .infinity)
				.background(
					GeometryReader { proxy in
						Color.clear
							.onAppear { chatsHeight = proxy.size.height }
							.onChange(of: proxy.size.height) { _, newValue in
								chatsHeight = newValue
							}
					}
				)
				.animation(.easeInOut(duration: 0.25), value: isWorkspaceScrolling)
			}
		}
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
