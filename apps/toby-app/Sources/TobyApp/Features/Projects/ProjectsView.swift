import SwiftUI

struct ProjectsView: View {
	@Bindable var projectsStore: ProjectsStore
	@Bindable var chatStore: ChatStore

	var body: some View {
		Group {
			if projectsStore.isShowingChat, projectsStore.selectedProject != nil {
				projectChat
			} else {
				projectsWorkspace
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(SettingsDesign.canvasBackground)
		.task {
			await projectsStore.ensureLoaded()
		}
		.alert(
			"Delete Project?",
			isPresented: Binding(
				get: { projectsStore.pendingDelete != nil },
				set: { if !$0 { projectsStore.pendingDelete = nil } },
			),
			presenting: projectsStore.pendingDelete,
		) { pending in
			Button("Cancel", role: .cancel) {
				projectsStore.pendingDelete = nil
			}
			Button("Delete", role: .destructive) {
				projectsStore.pendingDelete = nil
				Task {
					await projectsStore.deleteProject(
						id: pending.projectId,
						chatStore: chatStore,
					)
				}
			}
		} message: { pending in
			Text("Are you sure you want to delete \"\(pending.name)\"? This cannot be undone.")
		}
	}

	private var projectChat: some View {
		ChatWorkspaceView(store: chatStore, allowsProjectFileAttachments: true)
			.inspector(isPresented: $projectsStore.isFilesSidebarPresented) {
				ProjectFilesSidebarView(store: projectsStore)
					.inspectorColumnWidth(
						min: ProjectFilesInspectorLayout.minWidth,
						ideal: ProjectFilesInspectorLayout.idealWidth,
						max: ProjectFilesInspectorLayout.maxWidth
					)
			}
	}

	@ViewBuilder
	private var projectsWorkspace: some View {
		if projectsStore.isLoading && projectsStore.projects.isEmpty {
			ProgressView("Loading projects…")
				.frame(maxWidth: .infinity, maxHeight: .infinity)
		} else if let errorMessage = projectsStore.errorMessage, projectsStore.projects.isEmpty {
			ContentUnavailableView {
				Label("Projects unavailable", systemImage: "exclamationmark.triangle")
			} description: {
				Text(errorMessage)
			}
		} else if let project = projectsStore.selectedProject {
			ProjectDetailContent(
				store: projectsStore,
				project: project,
				onCreateChat: {
					Task { await projectsStore.createChat(chatStore: chatStore) }
				},
				onSelectChat: { id in
					Task { await projectsStore.selectChat(id: id, chatStore: chatStore) }
				},
			)
			.id(project.id)
		} else if projectsStore.projects.isEmpty {
			ProjectsEmptyStateView(
				isBusy: projectsStore.isLoading || projectsStore.isSaving,
				onCreate: {
					Task { await projectsStore.createProject() }
				},
			)
		} else {
			ProjectsIndexView(
				store: projectsStore,
				onSelect: { id in
					Task { await projectsStore.selectProject(id: id) }
				},
				onCreate: {
					Task { await projectsStore.createProject() }
				},
			)
		}
	}
}
