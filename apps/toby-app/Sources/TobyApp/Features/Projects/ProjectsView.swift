import SwiftUI

struct ProjectsView: View {
	@Bindable var projectsStore: ProjectsStore
	@Bindable var chatStore: ChatStore
	@State private var preferList = false

	var body: some View {
		FeatureWorkspaceSplit(
			listTitle: "Projects",
			isShowingList: preferList || projectsStore.selectedProject == nil,
			onShowList: { preferList = true }
		) {
			ProjectsSidebarView(
				store: projectsStore,
				onSelect: { id in
					Task { await projectsStore.selectProject(id: id) }
				},
				onSelectChat: { project, sessionId in
					Task {
						await projectsStore.selectChat(
							id: sessionId,
							chatStore: chatStore,
							projectId: project.id
						)
					}
				},
				onNewChat: { project in
					Task {
						await projectsStore.createChat(for: project.id, chatStore: chatStore)
					}
				},
				onDelete: { project in
					projectsStore.pendingDelete = ProjectsStore.PendingDelete(
						projectId: project.id,
						name: project.name,
					)
				}
			)
		} detail: {
			if projectsStore.isShowingChat, projectsStore.selectedProject != nil {
				projectChat
			} else {
				projectsWorkspace
			}
		}
		.onChange(of: projectsStore.selectedProjectId) { _, id in
			if id != nil { preferList = false }
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
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
		ChatWorkspaceView(
			store: chatStore,
			projectName: projectsStore.selectedProject?.name,
			allowsProjectFileAttachments: true,
		)
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
				.background(SettingsDesign.canvasBackground, ignoresSafeAreaEdges: [])
		} else if let errorMessage = projectsStore.errorMessage, projectsStore.projects.isEmpty {
			ContentUnavailableView {
				Label("Projects unavailable", systemImage: "exclamationmark.triangle")
			} description: {
				Text(errorMessage)
			}
			.background(SettingsDesign.canvasBackground, ignoresSafeAreaEdges: [])
		} else if let project = projectsStore.selectedProject {
			ProjectDetailContent(
				store: projectsStore,
				project: project,
				onSelectChat: { id in
					Task { await projectsStore.selectChat(id: id, chatStore: chatStore) }
				}
			)
			.id(project.id)
		} else {
			FeatureBrowserPlaceholder(
				systemImage: DetailRoute.projects.systemImage,
				title: "No project selected",
				prompt: "Select a project",
				onCreate: { Task { await projectsStore.createProject() } },
				createAccessibilityIdentifier: "empty-create-project-button"
			)
		}
	}
}
