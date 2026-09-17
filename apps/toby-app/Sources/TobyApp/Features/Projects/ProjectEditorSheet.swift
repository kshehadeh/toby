import SwiftUI

struct ProjectEditorSheet: View {
	@Bindable var store: ProjectsStore

	private var title: String {
		store.editor?.isNew == true ? "New Project" : "Edit Project"
	}

	var body: some View {
		EditorSheet(
			title: title,
			isSaving: store.isSaving,
			canSave: store.editor?.canSave ?? false,
			isDirty: store.isEditorDirty,
			errorMessage: store.editorError,
			size: .regular,
			accessibilityIdentifier: "project-editor-sheet",
			cancelAccessibilityIdentifier: "project-editor-cancel",
			saveAccessibilityIdentifier: "project-editor-save",
			onCancel: { store.cancelEditor() },
			onSave: { Task { await store.saveEditor() } }
		) {
			if let editorBinding {
				editorForm(draft: editorBinding)
			}
		}
	}

	private var editorBinding: Binding<ProjectEditorDraft>? {
		guard store.editor != nil else { return nil }
		return editorDraftBinding($store.editor, fallback: .blank())
	}

	private func editorForm(draft: Binding<ProjectEditorDraft>) -> some View {
		VStack(alignment: .leading, spacing: 16) {
			SkillSidebarField(
				title: "Name",
				placeholder: "Project name",
				accessibilityIdentifier: "project-title-field",
				text: draft.name
			)
			.padding(.horizontal, 20)
			.padding(.top, 20)

			VStack(alignment: .leading, spacing: 6) {
				Text("Persona")
					.font(.system(size: 12, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)
				Picker("Persona", selection: draft.personaName) {
					Text("Default").tag("")
					ForEach(store.personaOptions, id: \.name) { option in
						Text(option.label).tag(option.name)
					}
				}
				.labelsHidden()
				.pickerStyle(.menu)
				.frame(maxWidth: .infinity, alignment: .leading)
				.accessibilityIdentifier("project-persona-picker")
			}
			.padding(.horizontal, 20)

			VStack(alignment: .leading, spacing: 6) {
				Text("Summary")
					.font(.system(size: 12, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)
				MarkdownEditor(text: draft.summary)
					.frame(maxWidth: .infinity, maxHeight: .infinity)
			}
			.padding(.horizontal, 20)
			.padding(.bottom, 20)
		}
	}
}
