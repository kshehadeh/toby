import SwiftUI

enum ProjectDetailTab: String, Hashable, CaseIterable {
	case details
	case chats
}

struct ProjectDetailContent: View {
	@Bindable var store: ProjectsStore
	let project: ProjectSummary
	var onSelectChat: ((String) -> Void)?

	@State private var isSummaryEditorPresented = false

	var body: some View {
		TabView(selection: $store.selectedDetailTab) {
			Tab(value: ProjectDetailTab.details) {
				ProjectDetailsPane(
					store: store,
					project: project,
					isSummaryEditorPresented: $isSummaryEditorPresented
				)
			} label: {
				Text("Details")
			}
			Tab(value: ProjectDetailTab.chats) {
				ProjectChatsPane(store: store, onSelectChat: onSelectChat ?? { _ in })
			} label: {
				Text("Chats")
			}
		}
		.padding(AppTheme.contentPadding)
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(SettingsDesign.canvasBackground)
		.accessibilityIdentifier("project-detail-tabs")
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
}

struct ProjectDetailsPane: View {
	@Bindable var store: ProjectsStore
	let project: ProjectSummary
	@Binding var isSummaryEditorPresented: Bool

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 22) {
				nameField
				personaField
				summaryField
				pathSection
				ProjectFileTreeSection(store: store)
			}
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.padding(20)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.accessibilityIdentifier("project-details-tab")
	}

	private var summaryField: some View {
		let summary = store.selectedProject?.summary ?? project.summary
		let preview = projectSummaryFirstParagraph(summary)

		return VStack(alignment: .leading, spacing: 8) {
			Text("Summary")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)

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

	private var nameField: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Name")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			TextField("Project name", text: nameBinding)
				.textFieldStyle(.roundedBorder)
				.controlSize(.regular)
				.accessibilityIdentifier("project-title-field")
		}
	}

	private var nameBinding: Binding<String> {
		Binding(
			get: { store.selectedProject?.name ?? project.name },
			set: { store.updateName($0) }
		)
	}

	private var personaField: some View {
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

	private var pathSection: some View {
		VStack(alignment: .leading, spacing: 6) {
			Text("Folder")
				.font(.system(size: 12, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
			RevealPathButton(path: store.selectedProject?.folderPath ?? project.folderPath)
		}
	}
}

struct ProjectChatsPane: View {
	@Bindable var store: ProjectsStore
	let onSelectChat: (String) -> Void

	var body: some View {
		Group {
			if store.selectedProjectSessions.isEmpty {
				ContentUnavailableView {
					Label {
						Text("No chats yet")
					} icon: {
						Image(systemName: "bubble.left")
							.accessibilityHidden(true)
					}
				} description: {
					Text("Use + Chat in the toolbar to start one.")
				}
				.frame(maxWidth: .infinity, maxHeight: .infinity)
				.accessibilityIdentifier("project-chats-tab-empty")
			} else {
				ScrollView {
					VStack(alignment: .leading, spacing: 2) {
						ForEach(store.selectedProjectSessions) { session in
							Button {
								onSelectChat(session.id)
							} label: {
								ProjectChatsRow(session: session)
							}
							.buttonStyle(.plain)
							.accessibilityIdentifier("project-chats-tab-row-\(session.id)")
						}
					}
					.frame(maxWidth: .infinity, alignment: .topLeading)
				}
				.automaticScrollIndicators(axes: .vertical)
			}
		}
		.padding(20)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.accessibilityIdentifier("project-chats-tab")
	}
}

private struct ProjectChatsRow: View {
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
			Image(systemName: "chevron.right")
				.font(.system(size: 10, weight: .semibold))
				.foregroundStyle(AppTheme.tertiaryText)
				.padding(.top, 2)
		}
		.padding(.vertical, 8)
		.padding(.horizontal, 4)
		.contentShape(Rectangle())
	}
}

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
