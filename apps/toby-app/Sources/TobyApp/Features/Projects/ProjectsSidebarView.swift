import SwiftUI

struct ProjectsSidebarView: View {
	@Bindable var store: ProjectsStore
	let selectedSessionId: String?
	let onCreate: () -> Void
	let onSelect: (String) -> Void
	let onSelectSession: (String) -> Void

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			HStack {
				Text("Projects")
					.font(.system(size: 12, weight: .semibold))
					.foregroundStyle(AppTheme.secondaryText)
				Spacer()
				Button(action: onCreate) {
					Image(systemName: "plus")
				}
				.buttonStyle(.plain)
				.help("New Project")
				.accessibilityLabel("New Project")
			}
			.padding(.horizontal, 12)
			.padding(.vertical, 8)

			ScrollView {
				LazyVStack(alignment: .leading, spacing: 4) {
					if store.isLoading && store.projects.isEmpty {
						Text("Loading projects…")
							.font(.system(size: 12))
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(12)
					} else if store.projects.isEmpty {
						Text("No projects")
							.font(.system(size: 12))
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(12)
					} else {
						ForEach(store.projects) { project in
							let isSelectedProject = store.selectedProjectId == project.id
							VStack(alignment: .leading, spacing: 2) {
								Button {
									onSelect(project.id)
								} label: {
									HStack(spacing: 8) {
										Image(systemName: isSelectedProject ? "folder.fill" : "folder")
											.foregroundStyle(AppTheme.accent)
										VStack(alignment: .leading, spacing: 2) {
											Text(project.name)
												.font(.system(size: 13, weight: isSelectedProject ? .semibold : .medium))
												.lineLimit(1)
											if !project.summary.isEmpty {
												Text(project.summary)
													.font(.system(size: 11))
													.foregroundStyle(AppTheme.tertiaryText)
													.lineLimit(1)
											}
										}
										Spacer(minLength: 0)
									}
									.padding(.horizontal, 10)
									.padding(.vertical, 8)
								}
								.buttonStyle(.plain)
								if isSelectedProject {
									Rectangle()
										.fill(AppTheme.accent)
										.frame(maxWidth: .infinity)
										.frame(height: 1)
										.padding(.horizontal, 10)
										.padding(.top, 1)
										.padding(.bottom, 5)
								}

								if isSelectedProject {
									let sessions = store.sessions(for: project.id)
									if sessions.isEmpty {
										Text("No chats")
											.font(.system(size: 11))
											.foregroundStyle(AppTheme.tertiaryText)
											.padding(.leading, 32)
											.padding(.vertical, 3)
									} else {
										ForEach(sessions) { session in
											let isActive = session.id == selectedSessionId
											Button {
												onSelectSession(session.id)
											} label: {
												HStack(spacing: 6) {
													Image(systemName: isActive ? "bubble.left.fill" : "bubble.left")
														.foregroundStyle(isActive ? AppTheme.primaryText : AppTheme.secondaryText)
														.frame(width: 14)
													Text(session.name)
														.font(.system(size: 12))
														.foregroundStyle(isActive ? AppTheme.primaryText : AppTheme.secondaryText)
														.lineLimit(1)
													Spacer(minLength: 0)
													if isActive {
														Circle()
															.fill(Color.green)
															.frame(width: 7, height: 7)
													}
												}
												.padding(.leading, 30)
												.padding(.trailing, 8)
												.padding(.vertical, 5)
												.background(
													RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
														.fill(isActive ? AppTheme.selection.opacity(0.75) : Color.clear)
												)
											}
											.buttonStyle(.plain)
										}
									}
								}
							}
						}
					}
				}
				.padding(.horizontal, 8)
			}
		}
	}
}
