import SwiftUI

struct ProjectsView: View {
	@Bindable var projectsStore: ProjectsStore
	@Bindable var chatStore: ChatStore

	var body: some View {
		HStack(spacing: 0) {
			// Flexible main pane (no minWidth) so nav/inspector stay visible when narrow.
			projectChatArea
				.frame(maxWidth: .infinity, maxHeight: .infinity)
			Divider().overlay(AppTheme.separator)
			ProjectInspectorSidebar(store: projectsStore, chatStore: chatStore)
				.frame(width: 320)
				.frame(maxHeight: .infinity)
				.layoutPriority(1)
		}
		.background(AppTheme.contentBackground)
		.task {
			await projectsStore.ensureLoaded(chatStore: chatStore)
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

	@ViewBuilder
	private var projectChatArea: some View {
		if projectsStore.selectedProject == nil {
			ContentUnavailableView(
				"No Project Selected",
				systemImage: "folder",
				description: Text("Create or select a project.")
			)
		} else if projectsStore.selectedProjectSessions.isEmpty {
			ContentUnavailableView {
				Label("No Project Chat", systemImage: "bubble.left.and.bubble.right")
			} description: {
				Text("Start a chat for this project.")
			} actions: {
				Button("New Chat") {
					Task { await projectsStore.createChat(chatStore: chatStore) }
				}
				.buttonStyle(.borderedProminent)
			}
		} else {
			ChatWorkspaceView(store: chatStore)
		}
	}
}

private struct ProjectInspectorSidebar: View {
	@Bindable var store: ProjectsStore
	@Bindable var chatStore: ChatStore

	var body: some View {
		VStack(spacing: 0) {
			if let project = store.selectedProject {
				ScrollView {
					VStack(alignment: .leading, spacing: 18) {
						SkillSidebarField(
							title: "Name",
							placeholder: "Project name",
							text: Binding(
								get: { store.selectedProject?.name ?? project.name },
								set: { store.updateName($0) }
							)
						)
						summaryField(project: project)
						personaField(project: project)
						pathSection(project: project)
						Divider().overlay(SettingsDesign.cardBorder)
						fileTreeSection
					}
					.padding(18)
					.frame(maxWidth: .infinity, alignment: .leading)
				}

				Divider().overlay(SettingsDesign.cardBorder)

				HStack(spacing: 10) {
					Button {
						Task { await store.createChat(chatStore: chatStore) }
					} label: {
						Label("New Chat", systemImage: "plus.bubble")
							.frame(maxWidth: .infinity)
					}
					.buttonStyle(.borderedProminent)
					.controlSize(.regular)
					.disabled(store.isSaving)
					.accessibilityIdentifier("sidebar-new-project-chat-button")

					Button(role: .destructive) {
						store.pendingDelete = ProjectsStore.PendingDelete(
							projectId: project.id,
							name: project.name,
						)
					} label: {
						Label("Delete…", systemImage: "trash")
							.frame(maxWidth: .infinity)
					}
					.buttonStyle(.bordered)
					.controlSize(.regular)
					.tint(.red)
					.disabled(store.isSaving)
					.accessibilityIdentifier("sidebar-delete-project-button")
				}
				.padding(18)
			} else {
				ContentUnavailableView(
					"No Project Selected",
					systemImage: "folder",
					description: Text("Create or select a project.")
				)
				.padding()
			}
		}
		.background(AppTheme.sidebarBackground)
	}

	private func summaryField(project: ProjectSummary) -> some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Summary")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			TextEditor(
				text: Binding(
					get: { store.selectedProject?.summary ?? project.summary },
					set: { store.updateSummary($0) }
				)
			)
			.font(.system(size: 13))
			.scrollContentBackground(.hidden)
			.frame(minHeight: 92)
			.padding(8)
			.background(
				RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
					.fill(AppTheme.elevatedBackground)
			)
			.overlay(
				RoundedRectangle(cornerRadius: AppTheme.smallCornerRadius)
					.stroke(SettingsDesign.cardBorder, lineWidth: 1)
			)
		}
	}

	private func personaField(project: ProjectSummary) -> some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Persona")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			Picker("Persona", selection: Binding(
				get: { store.selectedProject?.personaName ?? "" },
				set: { store.updatePersona($0) }
			)) {
				Text("Default").tag("")
				ForEach(store.personaOptions, id: \.name) { option in
					Text(option.label).tag(option.name)
				}
			}
			.labelsHidden()
			.pickerStyle(.menu)
			.frame(maxWidth: .infinity, alignment: .leading)
		}
	}

	private func pathSection(project: ProjectSummary) -> some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Folder")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			RevealPathButton(path: project.folderPath)
		}
	}

	private var fileTreeSection: some View {
		VStack(alignment: .leading, spacing: 8) {
			HStack {
				Text("Files")
					.font(.system(size: 12, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)
				Spacer()
				Button {
					Task { await store.refreshTree() }
				} label: {
					Image(systemName: "arrow.clockwise")
				}
				.buttonStyle(.plain)
				.help("Refresh files")
			}
			if store.tree.isEmpty {
				Text("No files")
					.font(.system(size: 12))
					.foregroundStyle(AppTheme.tertiaryText)
			} else {
				VStack(alignment: .leading, spacing: 2) {
					ForEach(store.tree) { entry in
						ProjectTreeRow(
							entry: entry,
							projectFolderPath: store.selectedProject?.folderPath ?? "",
							depth: 0
						)
					}
				}
			}
		}
	}
}

private struct ProjectTreeRow: View {
	let entry: ProjectTreeEntry
	let projectFolderPath: String
	let depth: Int
	@State private var isExpanded = true

	var body: some View {
		VStack(alignment: .leading, spacing: 2) {
			Button {
				if entry.isDirectory {
					isExpanded.toggle()
				} else {
					RevealInFinder.openWithDefaultApp(path: absolutePath)
				}
			} label: {
				HStack(spacing: 6) {
					if entry.isDirectory {
						Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
							.frame(width: 12)
							.foregroundStyle(AppTheme.tertiaryText)
					} else {
						Color.clear
							.frame(width: 12, height: 1)
					}
					Image(systemName: entry.isDirectory ? "folder" : "doc")
						.foregroundStyle(entry.isDirectory ? AppTheme.accent : AppTheme.secondaryText)
					Text(entry.name)
						.font(.system(size: 12))
						.lineLimit(1)
					Spacer(minLength: 0)
				}
				.padding(.leading, CGFloat(depth) * 14)
				.padding(.vertical, 3)
			}
			.buttonStyle(.plain)
			.help(entry.isDirectory ? (isExpanded ? "Collapse folder" : "Expand folder") : "Open with default app")
			.accessibilityLabel(entry.isDirectory ? entry.name : "Open \(entry.name)")
			if entry.isDirectory && isExpanded {
				ForEach(entry.children ?? []) { child in
					ProjectTreeRow(
						entry: child,
						projectFolderPath: projectFolderPath,
						depth: depth + 1
					)
				}
			}
		}
	}

	private var absolutePath: String {
		URL(fileURLWithPath: entry.relativePath, relativeTo: URL(fileURLWithPath: projectFolderPath, isDirectory: true))
			.standardizedFileURL
			.path
	}
}
