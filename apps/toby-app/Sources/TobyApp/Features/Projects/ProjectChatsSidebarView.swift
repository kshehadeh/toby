import SwiftUI

enum ProjectChatsInspectorLayout {
	static let minWidth: CGFloat = 220
	static let idealWidth: CGFloat = 260
	static let maxWidth: CGFloat = 400
}

/// Trailing inspector listing the selected project's chats. Uses the same
/// native `.inspector` presentation as the dashboard actions rail.
struct ProjectChatsSidebarView: View {
	@Bindable var store: ProjectsStore
	let onSelectChat: (String) -> Void

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 8) {
				Text("Chats")
					.font(.system(size: 12, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)

				if store.selectedProjectSessions.isEmpty {
					Text("No chats yet. Use + Chat in the toolbar to start one.")
						.font(.system(size: 12))
						.foregroundStyle(AppTheme.tertiaryText)
						.accessibilityIdentifier("project-chats-sidebar-empty")
				} else {
					VStack(alignment: .leading, spacing: 2) {
						ForEach(store.selectedProjectSessions) { session in
							Button {
								onSelectChat(session.id)
							} label: {
								ProjectChatsSidebarRow(session: session)
							}
							.buttonStyle(.plain)
							.accessibilityIdentifier("project-chats-sidebar-row-\(session.id)")
						}
					}
				}
			}
			.padding(16)
			.frame(maxWidth: .infinity, alignment: .topLeading)
		}
		.automaticScrollIndicators(axes: .vertical)
		.background(AppTheme.contentBackground)
		.accessibilityIdentifier("project-chats-sidebar")
	}
}

private struct ProjectChatsSidebarRow: View {
	let session: SessionSummary

	var body: some View {
		HStack(alignment: .top, spacing: 8) {
			Image(systemName: session.isExternal ? "bubble.left.and.bubble.right" : "bubble.left")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(AppTheme.secondaryText)
				.frame(width: 16, height: 16)
				.padding(.top, 2)
			VStack(alignment: .leading, spacing: 2) {
				Text(session.name)
					.font(.system(size: 12, weight: .medium))
					.foregroundStyle(AppTheme.secondaryText)
					.lineLimit(1)
				if let date = sidebarSessionDate(session) {
					Text(date)
						.font(.system(size: 10))
						.foregroundStyle(AppTheme.tertiaryText)
						.lineLimit(1)
				}
			}
			Spacer(minLength: 0)
		}
		.padding(.vertical, 6)
		.padding(.horizontal, 8)
		.contentShape(Rectangle())
	}
}
