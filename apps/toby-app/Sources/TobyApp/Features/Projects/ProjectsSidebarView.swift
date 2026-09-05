import SwiftUI

struct ProjectsSidebarView: View {
	@Bindable var store: ProjectsStore
	let onSelect: (String) -> Void
	var onSelectChat: (ProjectSummary, String) -> Void = { _, _ in }
	var onDelete: ((ProjectSummary) -> Void)? = nil

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			ScrollView {
				LazyVStack(alignment: .leading, spacing: 2) {
					if store.isLoading && store.projects.isEmpty {
						Text("Loading projects…")
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(10)
					} else if store.projects.isEmpty {
						Text("No projects")
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(10)
					} else {
						ForEach(store.projects) { project in
							Button {
								onSelect(project.id)
							} label: {
								ProjectSidebarRow(
									project: project,
									metaLine: store.metaLine(for: project),
									isSelected: store.selectedProjectId == project.id,
									isActiveChat: store.isShowingChat
										&& store.selectedProjectId == project.id,
								)
							}
							.buttonStyle(.plain)
							.contextMenu {
								let recentChats = store.recentSessions(for: project.id, limit: 10)
								Section("Recent Chats") {
									if recentChats.isEmpty {
										Button("No chats yet") {}
											.disabled(true)
									} else {
										ForEach(recentChats) { session in
											Button {
												onSelectChat(project, session.id)
											} label: {
												Label(session.name, systemImage: "bubble.left")
											}
										}
									}
								}
								if let onDelete {
									Divider()
									Button("Delete Project", systemImage: "trash", role: .destructive) {
										onDelete(project)
									}
								}
							}
						}
					}
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(.horizontal, 8)
				.padding(.top, 8)
			}
		}
	}
}

struct ProjectSidebarRow: View {
	let project: ProjectSummary
	let metaLine: String
	let isSelected: Bool
	var isActiveChat = false

	var body: some View {
		HStack(spacing: 12) {
			Image(systemName: isSelected ? "folder.fill" : "folder")
				.font(.system(size: 14, weight: .semibold))
				.foregroundStyle(isSelected ? AppTheme.accent : AppTheme.tertiaryText)
				.frame(width: 20, height: 20)
				.contentTransition(.symbolEffect(.replace))

			VStack(alignment: .leading, spacing: 2) {
				Text(project.name)
					.font(.callout.weight(.medium))
					.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
					.lineLimit(1)
				Text(metaLine)
					.font(.caption)
					.foregroundStyle(AppTheme.tertiaryText)
					.lineLimit(1)
			}
			Spacer(minLength: 0)
			if isActiveChat {
				Image(systemName: "bubble.left.fill")
					.font(.system(size: 10, weight: .semibold))
					.foregroundStyle(AppTheme.accent)
					.accessibilityHidden(true)
			}
		}
		.padding(.vertical, 8)
		.padding(.horizontal, 10)
		.contentShape(Rectangle())
		.background(
			RoundedRectangle(cornerRadius: 8)
				.fill(isSelected ? AppTheme.selection : Color.clear)
		)
		.accessibilityElement(children: .combine)
		.accessibilityLabel(
			isActiveChat
				? "\(project.name), \(metaLine), open chat"
				: "\(project.name), \(metaLine)"
		)
		.accessibilityAddTraits(isSelected ? [.isSelected] : [])
		.accessibilityIdentifier(
			isActiveChat
				? "project-sidebar-active-chat"
				: "project-sidebar-row-\(project.id)"
		)
	}
}
