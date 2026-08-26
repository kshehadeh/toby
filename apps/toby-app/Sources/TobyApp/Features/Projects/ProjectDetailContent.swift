import SwiftUI

struct ProjectDetailContent: View {
	@Bindable var store: ProjectsStore
	let project: ProjectSummary
	let onCreateChat: () -> Void
	let onSelectChat: (String) -> Void

	@State private var isSummaryEditorPresented = false
	@State private var showingAllChats = false

	private var visibleSessions: [SessionSummary] {
		showingAllChats ? store.selectedProjectSessions : store.recentSessions()
	}

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 24) {
				header
				newChatButton
				recentChatsSection
				ViewThatFits(in: .horizontal) {
					HStack(alignment: .top, spacing: 20) {
						aboutCard.frame(minWidth: 280)
						filesCard.frame(minWidth: 280)
					}
					VStack(alignment: .leading, spacing: 20) {
						aboutCard
						filesCard
					}
				}
			}
			.padding(28)
			.frame(maxWidth: 980)
			.frame(maxWidth: .infinity)
		}
		.background(SettingsDesign.canvasBackground)
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

	private var header: some View {
		HStack(alignment: .center, spacing: 14) {
			RoundedRectangle(cornerRadius: 12)
				.fill(AppTheme.accent.opacity(0.16))
				.frame(width: 48, height: 48)
				.overlay {
					Image(systemName: "folder.fill")
						.font(.system(size: 20, weight: .semibold))
						.foregroundStyle(AppTheme.accent)
				}

			VStack(alignment: .leading, spacing: 4) {
				Text(store.selectedProject?.name ?? project.name)
					.font(.system(size: 22, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)
					.lineLimit(1)
				Text(store.metaLine(for: store.selectedProject ?? project))
					.font(.subheadline)
					.foregroundStyle(AppTheme.secondaryText)
			}

			Spacer(minLength: 0)
		}
	}

	private var newChatButton: some View {
		Button(action: onCreateChat) {
			Label("New Chat", systemImage: "plus.bubble")
				.font(.system(size: 15, weight: .semibold))
				.frame(maxWidth: .infinity)
				.padding(.vertical, 6)
		}
		.buttonStyle(.borderedProminent)
		.controlSize(.large)
		.disabled(store.isSaving)
		.accessibilityIdentifier("project-new-chat-button")
	}

	private var recentChatsSection: some View {
		VStack(alignment: .leading, spacing: 10) {
			Text("Recent chats")
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)

			if store.selectedProjectSessions.isEmpty {
				Text("No chats yet. Start one to keep this project's work together.")
					.font(.system(size: 13))
					.foregroundStyle(AppTheme.tertiaryText)
					.padding(.vertical, 8)
			} else {
				SettingsCard {
					ForEach(Array(visibleSessions.enumerated()), id: \.element.id) { index, session in
						Button {
							onSelectChat(session.id)
						} label: {
							HStack(spacing: 10) {
								Image(systemName: "bubble.left")
									.foregroundStyle(AppTheme.secondaryText)
									.frame(width: 16)
								VStack(alignment: .leading, spacing: 1) {
									Text(session.name)
										.font(.system(size: 13, weight: .medium))
										.foregroundStyle(SettingsDesign.rowTitle)
										.lineLimit(1)
									if let date = sidebarSessionDate(session) {
										Text(date)
											.font(.caption)
											.foregroundStyle(AppTheme.tertiaryText)
									}
								}
								Spacer(minLength: 0)
								Image(systemName: "chevron.right")
									.font(.system(size: 11, weight: .semibold))
									.foregroundStyle(AppTheme.tertiaryText)
							}
							.padding(.horizontal, 12)
							.padding(.vertical, 10)
							.contentShape(Rectangle())
						}
						.buttonStyle(.plain)
						.accessibilityIdentifier("project-recent-chat-\(session.id)")

						if index < visibleSessions.count - 1 {
							Rectangle()
								.fill(SettingsDesign.cardBorder)
								.frame(height: 1)
								.padding(.leading, 38)
						}
					}
				}

				if !showingAllChats, store.selectedProjectSessions.count > 5 {
					Button("Show all \(store.selectedProjectSessions.count) chats") {
						showingAllChats = true
					}
					.buttonStyle(.plain)
					.font(.caption.weight(.medium))
					.foregroundStyle(AppTheme.accent)
					.accessibilityIdentifier("project-show-all-chats-button")
				}
			}
		}
	}

	private var aboutCard: some View {
		VStack(alignment: .leading, spacing: 16) {
			Text("About")
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)

			SkillSidebarField(
				title: "Name",
				placeholder: "Project name",
				text: Binding(
					get: { store.selectedProject?.name ?? project.name },
					set: { store.updateName($0) }
				)
			)
			personaField
			summaryField
			pathSection
		}
		.padding(18)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.fill(SettingsDesign.cardBackground)
		)
		.overlay(
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		)
	}

	private var filesCard: some View {
		VStack(alignment: .leading, spacing: 16) {
			ProjectFileTreeSection(store: store)
		}
		.padding(18)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.fill(SettingsDesign.cardBackground)
		)
		.overlay(
			RoundedRectangle(cornerRadius: SettingsDesign.cardCornerRadius)
				.stroke(SettingsDesign.cardBorder, lineWidth: 1)
		)
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
