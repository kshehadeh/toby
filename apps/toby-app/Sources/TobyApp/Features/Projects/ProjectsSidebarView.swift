import SwiftUI

struct ProjectsSidebarView: View {
	@Bindable var store: ProjectsStore
	let onSelect: (String) -> Void
	var onSelectChat: (ProjectSummary, String) -> Void = { _, _ in }
	var onNewChat: (ProjectSummary) -> Void = { _ in }
	var onDelete: ((ProjectSummary) -> Void)? = nil

	var body: some View {
		FeatureBrowserList(
			isLoading: store.isLoading,
			isEmpty: store.projects.isEmpty,
			loadingText: "Loading projects…",
			emptyText: "No projects",
			onClearSelection: {
				Task { await store.selectHome() }
			}
		) {
			ForEach(store.projects) { project in
				ProjectSidebarItem(
					project: project,
					metaLine: store.metaLine(for: project),
					recentChats: store.recentSessions(for: project.id, limit: 10),
					isSelected: store.selectedProjectId == project.id,
					isActiveChat: store.isShowingChat
						&& store.selectedProjectId == project.id,
					onSelect: { onSelect(project.id) },
					onNewChat: { onNewChat(project) },
					onSelectChat: { sessionId in
						onSelectChat(project, sessionId)
					},
					onDelete: onDelete.map { delete in
						{ delete(project) }
					}
				)
			}
		}
	}
}

private struct ProjectSidebarItem: View {
	let project: ProjectSummary
	let metaLine: String
	let recentChats: [SessionSummary]
	let isSelected: Bool
	let isActiveChat: Bool
	let onSelect: () -> Void
	let onNewChat: () -> Void
	let onSelectChat: (String) -> Void
	var onDelete: (() -> Void)?
	@State private var isHovered = false

	var body: some View {
		HStack(spacing: 0) {
			Button(action: onSelect) {
				ProjectSidebarRow(
					project: project,
					metaLine: metaLine,
					isSelected: isSelected,
					isActiveChat: isActiveChat,
					drawsSelectionFill: false
				)
			}
			.buttonStyle(.plain)
			.accessibilityIdentifier("project-sidebar-select-\(project.id)")

			ProjectChatSplitMenu(
				project: project,
				recentChats: recentChats,
				isHighlighted: isSelected || isHovered,
				onNewChat: onNewChat,
				onSelectChat: onSelectChat
			)
			.padding(.trailing, FeatureBrowserMetrics.rowHorizontalPadding)
		}
		.background {
			RoundedRectangle(cornerRadius: FeatureBrowserMetrics.rowCornerRadius)
				.fill(isSelected ? AppTheme.selection : Color.clear)
				.transaction { $0.disablesAnimations = true }
		}
		.onHover { isHovered = $0 }
		.contextMenu {
			Button("New Chat", systemImage: "plus", action: onNewChat)
			Divider()
			Section("Recent Chats") {
				if recentChats.isEmpty {
					Button("No chats yet") {}
						.disabled(true)
				} else {
					ForEach(recentChats) { session in
						Button {
							onSelectChat(session.id)
						} label: {
							Label(session.name, systemImage: "bubble.left")
						}
					}
				}
			}
			if let onDelete {
				Divider()
				Button("Delete Project", systemImage: "trash", role: .destructive) {
					onDelete()
				}
			}
		}
	}
}

struct ProjectSidebarRow: View {
	let project: ProjectSummary
	let metaLine: String
	let isSelected: Bool
	var isActiveChat = false
	var drawsSelectionFill = true

	var body: some View {
		FeatureBrowserRow(
			title: project.name,
			subtitle: metaLine,
			isSelected: isSelected,
			drawsSelectionFill: drawsSelectionFill,
			accessibilityLabel: isActiveChat
				? "\(project.name), \(metaLine), open chat"
				: "\(project.name), \(metaLine)",
			accessibilityIdentifier: isActiveChat
				? "project-sidebar-active-chat"
				: "project-sidebar-row-\(project.id)"
		) {
			FeatureBrowserRowGlyph(systemImage: "folder", isSelected: isSelected)
		} trailing: {
			if isActiveChat {
				Image(systemName: "bubble.left.fill")
					.font(.system(size: 10, weight: .semibold))
					.foregroundStyle(AppTheme.accent)
					.accessibilityHidden(true)
			}
		}
	}
}

/// Split + control on a project row: click starts a chat; the chevron lists
/// recent chats. `primaryAction` menus snapshot items at creation — identity
/// must include the chat ids so the dropdown rebuilds when they change.
struct ProjectChatSplitMenu: View {
	let project: ProjectSummary
	let recentChats: [SessionSummary]
	var isHighlighted = false
	let onNewChat: () -> Void
	let onSelectChat: (String) -> Void

	var body: some View {
		Menu {
			Button("New Chat", systemImage: "plus", action: onNewChat)
				.accessibilityIdentifier("project-sidebar-new-chat-item-\(project.id)")

			Divider()

			Section("Recent Chats") {
				if recentChats.isEmpty {
					Button("No chats yet") {}
						.disabled(true)
				} else {
					ForEach(recentChats) { session in
						Button {
							onSelectChat(session.id)
						} label: {
							Label(session.name, systemImage: "bubble.left")
						}
						.accessibilityIdentifier("project-sidebar-chat-\(session.id)")
					}
				}
			}
		} label: {
			Image(systemName: "plus")
				.font(.system(size: 11, weight: .semibold))
				.foregroundStyle(isHighlighted ? AppTheme.accent : AppTheme.tertiaryText)
				.frame(width: 20, height: 20)
				.contentShape(Rectangle())
		} primaryAction: {
			onNewChat()
		}
		.id(menuIdentity)
		.menuIndicator(.visible)
		.buttonStyle(.borderless)
		.help("New Chat")
		.accessibilityIdentifier("project-sidebar-new-chat-\(project.id)")
		.accessibilityLabel("New Chat")
	}

	private var menuIdentity: String {
		let chatIds = recentChats.map(\.id).joined(separator: "\u{1e}")
		return "\(project.id)-\(chatIds)"
	}
}
