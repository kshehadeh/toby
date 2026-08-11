import SwiftUI

struct ProjectsView: View {
	@Bindable var projectsStore: ProjectsStore
	@Bindable var chatStore: ChatStore

	var body: some View {
		HStack(spacing: 0) {
			// Chat pane is isolated in its own view type so inspector tree polls /
			// TextEditor layout never rebuild the transcript while scrolling.
			ProjectChatPane(
				chatStore: chatStore,
				hasSelectedProject: projectsStore.selectedProject != nil,
				hasSessions: !projectsStore.selectedProjectSessions.isEmpty,
				onCreateChat: {
					Task { await projectsStore.createChat(chatStore: chatStore) }
				},
			)
			.frame(maxWidth: .infinity, maxHeight: .infinity)
			.layoutPriority(1)

			Divider().overlay(AppTheme.separator)

			ProjectInspectorSidebar(
				store: projectsStore,
				onCreateChat: {
					Task { await projectsStore.createChat(chatStore: chatStore) }
				},
			)
			.frame(width: 320)
			.frame(maxHeight: .infinity)
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
}

// MARK: - Chat pane (observation-isolated from project inspector)

/// Only depends on `ChatStore` (+ lightweight flags). Folder-tree polling and
/// inspector edits must not invalidate this subtree while the user scrolls.
private struct ProjectChatPane: View {
	@Bindable var chatStore: ChatStore
	let hasSelectedProject: Bool
	let hasSessions: Bool
	let onCreateChat: () -> Void

	var body: some View {
		Group {
			if !hasSelectedProject {
				ContentUnavailableView(
					"No Project Selected",
					systemImage: "folder",
					description: Text("Create or select a project.")
				)
			} else if !hasSessions {
				ContentUnavailableView {
					Label("No Project Chat", systemImage: "bubble.left.and.bubble.right")
				} description: {
					Text("Start a chat for this project.")
				} actions: {
					Button("New Chat", action: onCreateChat)
						.buttonStyle(.borderedProminent)
				}
			} else {
				ChatWorkspaceView(store: chatStore)
			}
		}
	}
}

// MARK: - Summary helpers

/// First non-empty paragraph of a project summary (text up to the first blank line).
func projectSummaryFirstParagraph(_ text: String) -> String {
	let normalized = text
		.replacingOccurrences(of: "\r\n", with: "\n")
		.replacingOccurrences(of: "\r", with: "\n")
	let trimmed = normalized.trimmingCharacters(in: .whitespacesAndNewlines)
	guard !trimmed.isEmpty else { return "" }
	guard let blankLine = trimmed.range(of: #"\n[ \t]*\n"#, options: .regularExpression) else {
		return trimmed
	}
	return String(trimmed[..<blankLine.lowerBound])
		.trimmingCharacters(in: .whitespacesAndNewlines)
}

// MARK: - Inspector

private struct ProjectInspectorSidebar: View {
	@Bindable var store: ProjectsStore
	let onCreateChat: () -> Void
	@State private var isSummaryEditorPresented = false

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
						ProjectFileTreeSection(store: store)
					}
					.padding(18)
					.frame(maxWidth: .infinity, alignment: .leading)
				}

				Divider().overlay(SettingsDesign.cardBorder)

				HStack(spacing: 10) {
					Button(action: onCreateChat) {
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
		.sheet(isPresented: $isSummaryEditorPresented) {
			ProjectSummaryEditorSheet(
				initialSummary: store.selectedProject?.summary ?? "",
				isSaving: store.isSaving,
				onSave: { text in
					store.updateSummary(text)
					isSummaryEditorPresented = false
					Task { await store.flushPendingSave() }
				},
				onCancel: {
					isSummaryEditorPresented = false
				}
			)
		}
	}

	private func summaryField(project: ProjectSummary) -> some View {
		let summary = store.selectedProject?.summary ?? project.summary
		let preview = projectSummaryFirstParagraph(summary)

		return VStack(alignment: .leading, spacing: 8) {
			Text("Summary")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)

			// Read-only first paragraph keeps the inspector compact; full editing
			// happens in ProjectSummaryEditorSheet.
			Group {
				if preview.isEmpty {
					Text("No summary yet")
						.font(.system(size: 13))
						.foregroundStyle(AppTheme.tertiaryText)
						.frame(maxWidth: .infinity, alignment: .leading)
						.accessibilityIdentifier("project-summary-empty-placeholder")
				} else {
					Text(preview)
						.font(.system(size: 13))
						.foregroundStyle(SettingsDesign.rowTitle)
						.multilineTextAlignment(.leading)
						.lineLimit(5)
						.fixedSize(horizontal: false, vertical: true)
						.textSelection(.enabled)
						.frame(maxWidth: .infinity, alignment: .leading)
						.accessibilityIdentifier("project-summary-preview")
				}
			}

			Button {
				isSummaryEditorPresented = true
			} label: {
				Label("Edit", systemImage: "square.and.pencil")
					.frame(maxWidth: .infinity)
			}
			.buttonStyle(.bordered)
			.controlSize(.small)
			.disabled(store.isSaving)
			.accessibilityIdentifier("project-summary-edit-button")
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
}

// MARK: - Summary editor sheet

/// Full markdown editor for a project summary. Edits a local draft so Cancel
/// discards changes without triggering the store's autosave path.
struct ProjectSummaryEditorSheet: View {
	let initialSummary: String
	let isSaving: Bool
	let onSave: (String) -> Void
	let onCancel: () -> Void

	@State private var draft = ""

	var body: some View {
		VStack(spacing: 0) {
			HStack {
				Text("Edit Summary")
					.font(.title3.weight(.semibold))
					.foregroundStyle(AppTheme.primaryText)
				Spacer()
			}
			.padding(.horizontal, 20)
			.padding(.top, 20)
			.padding(.bottom, 12)

			MarkdownEditor(text: $draft)
				.padding(.horizontal, 20)
				.frame(maxWidth: .infinity, maxHeight: .infinity)

			HStack(spacing: 12) {
				Spacer()
				Button("Cancel", role: .cancel) {
					onCancel()
				}
				.disabled(isSaving)
				.keyboardShortcut(.cancelAction)

				Button("Save") {
					onSave(draft)
				}
				.buttonStyle(.borderedProminent)
				.disabled(isSaving)
				.keyboardShortcut(.defaultAction)
				.accessibilityIdentifier("project-summary-save-button")
			}
			.padding(.horizontal, 20)
			.padding(.vertical, 16)
			.overlay(alignment: .top) {
				Rectangle()
					.fill(SettingsDesign.cardBorder)
					.frame(height: 1)
			}
		}
		.padding(.bottom, 4)
		.frame(minWidth: 560, idealWidth: 640, minHeight: 420, idealHeight: 480)
		.background(SettingsDesign.canvasBackground)
		.accessibilityIdentifier("project-summary-editor-sheet")
		.onAppear {
			draft = initialSummary
		}
	}
}

/// File tree + 2s folder poll live only here so they never invalidate the chat pane.
private struct ProjectFileTreeSection: View {
	@Bindable var store: ProjectsStore

	var body: some View {
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
	@Environment(\.accessibilityReduceMotion) private var reduceMotion

	private var expandAnimation: Animation? {
		reduceMotion ? nil : .easeOut(duration: 0.2)
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 2) {
			Button {
				if entry.isDirectory {
					withAnimation(expandAnimation) {
						isExpanded.toggle()
					}
				} else {
					RevealInFinder.openWithDefaultApp(path: absolutePath)
				}
			} label: {
				HStack(spacing: 6) {
					if entry.isDirectory {
						Image(systemName: "chevron.right")
							.font(.system(size: 10, weight: .semibold))
							.frame(width: 12)
							.foregroundStyle(AppTheme.tertiaryText)
							.rotationEffect(.degrees(isExpanded ? 90 : 0))
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
			.accessibilityValue(entry.isDirectory ? (isExpanded ? "Expanded" : "Collapsed") : "")
			if entry.isDirectory, isExpanded {
				VStack(alignment: .leading, spacing: 2) {
					ForEach(entry.children ?? []) { child in
						ProjectTreeRow(
							entry: child,
							projectFolderPath: projectFolderPath,
							depth: depth + 1
						)
					}
				}
				.transition(
					reduceMotion
						? .opacity
						: .opacity.combined(with: .move(edge: .top))
				)
			}
		}
		.clipped()
		.animation(expandAnimation, value: isExpanded)
	}

	private var absolutePath: String {
		URL(fileURLWithPath: entry.relativePath, relativeTo: URL(fileURLWithPath: projectFolderPath, isDirectory: true))
			.standardizedFileURL
			.path
	}
}
