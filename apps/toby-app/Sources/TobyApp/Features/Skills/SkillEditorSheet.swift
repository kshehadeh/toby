import SwiftUI
import UniformTypeIdentifiers

struct SkillEditorSheet: View {
	@Bindable var store: SkillsStore
	@State private var isIconPickerPresented = false
	@State private var selectedTab: SkillDetailTab = .about

	private var title: String {
		store.editor?.isNew == true ? "New Skill" : "Edit Skill"
	}

	var body: some View {
		EditorSheet(
			title: title,
			isSaving: store.isSaving,
			canSave: store.editor?.canSave ?? false,
			isDirty: store.isEditorDirty,
			errorMessage: store.editorError,
			size: .wide,
			accessibilityIdentifier: "skill-editor-sheet",
			cancelAccessibilityIdentifier: "skill-editor-cancel",
			saveAccessibilityIdentifier: "skill-editor-save",
			onCancel: { store.cancelEditor() },
			onSave: { Task { await store.saveEditor() } }
		) {
			if store.editor != nil {
				VStack(spacing: 16) {
					Picker("Section", selection: $selectedTab) {
						Text("About").tag(SkillDetailTab.about)
						Text("Instructions").tag(SkillDetailTab.instructions)
					}
					.pickerStyle(.segmented)
					.labelsHidden()
					.frame(maxWidth: 280)
					.accessibilityIdentifier("skill-editor-tabs")

					ZStack {
						SkillEditorAboutPane(
							store: store,
							isIconPickerPresented: $isIconPickerPresented
						)
						.opacity(selectedTab == .about ? 1 : 0)
						.allowsHitTesting(selectedTab == .about)
						.accessibilityHidden(selectedTab != .about)
						SkillEditorInstructionsPane(store: store)
							.opacity(selectedTab == .instructions ? 1 : 0)
							.allowsHitTesting(selectedTab == .instructions)
							.accessibilityHidden(selectedTab != .instructions)
					}
					.frame(maxWidth: .infinity, maxHeight: .infinity)
					.animation(nil, value: selectedTab)
				}
				.padding(AppTheme.contentPadding)
			}
		}
		.fileImporter(
			isPresented: $isIconPickerPresented,
			allowedContentTypes: [.png, .jpeg, .image],
			allowsMultipleSelection: false,
		) { result in
			handleIconPickerResult(result)
		}
	}

	private func handleIconPickerResult(_ result: Result<[URL], Error>) {
		switch result {
		case .success(let urls):
			guard let url = urls.first else { return }
			do {
				let accessed = url.startAccessingSecurityScopedResource()
				defer {
					if accessed { url.stopAccessingSecurityScopedResource() }
				}
				let data = try Data(contentsOf: url)
				store.editor?.pendingIconData = data
				store.editor?.pendingIconFilename = url.lastPathComponent
				store.editor?.resetIcon = false
				store.editor?.hasCustomIcon = true
			} catch {
				store.editorError = error.localizedDescription
			}
		case .failure(let error):
			store.editorError = error.localizedDescription
		}
	}
}

struct SkillEditorAboutPane: View {
	@Bindable var store: SkillsStore
	@Binding var isIconPickerPresented: Bool

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 16) {
				iconRow
				SkillSidebarField(
					title: "Name",
					placeholder: "Skill name",
					accessibilityIdentifier: "skill-title-field",
					text: draftBinding(\.name)
				)
				SkillSidebarField(
					title: "Summary",
					hint: "Used to display and choose this skill",
					placeholder: "What this skill does and when to use it",
					axis: .vertical,
					text: draftBinding(\.summary)
				)
				enableRow
			}
			.padding(20)
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.scrollBounceBehavior(.basedOnSize)
		.accessibilityIdentifier("skill-editor-about")
	}

	private var iconRow: some View {
		HStack(alignment: .center, spacing: 12) {
			EditableSkillIcon(
				iconURL: displayedIconURL,
				hasCustomIcon: store.editor?.hasCustomIcon == true && store.editor?.resetIcon != true,
				isDisabled: store.isSaving,
				onChoose: { isIconPickerPresented = true },
				onReset: {
					store.editor?.resetIcon = true
					store.editor?.pendingIconData = nil
					store.editor?.pendingIconFilename = nil
					store.editor?.hasCustomIcon = false
				}
			)
			VStack(alignment: .leading, spacing: 2) {
				Text("Icon")
					.font(.system(size: 12, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)
				Text("Click to change. Reset a custom icon from the context menu.")
					.font(.system(size: 11))
					.foregroundStyle(SettingsDesign.rowDescription)
			}
		}
	}

	private var displayedIconURL: URL? {
		guard let editor = store.editor, !editor.resetIcon else { return nil }
		return editor.iconURL
	}

	private var enableRow: some View {
		HStack {
			VStack(alignment: .leading, spacing: 2) {
				Text("Enabled")
					.font(.system(size: 12, weight: .semibold))
					.foregroundStyle(SettingsDesign.rowTitle)
				Text(
					(store.editor?.enabled ?? true)
						? "Offered to the model"
						: "Hidden from the model"
				)
				.font(.system(size: 11))
				.foregroundStyle(SettingsDesign.rowDescription)
			}
			Spacer()
			SettingsToggle(isOn: draftBinding(\.enabled))
		}
	}

	private func draftBinding<Value>(_ keyPath: WritableKeyPath<SkillEditorDraft, Value>) -> Binding<Value> {
		editorDraftFieldBinding($store.editor, keyPath, fallback: .blank())
	}
}

struct SkillEditorInstructionsPane: View {
	@Bindable var store: SkillsStore

	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			Text("Sent to the model when this skill runs")
				.font(.caption)
				.foregroundStyle(SettingsDesign.rowDescription)
			SkillMarkdownEditor(text: editorDraftFieldBinding($store.editor, \.bodyMarkdown, fallback: .blank()))
				.frame(maxWidth: .infinity, maxHeight: .infinity)
		}
		.padding(20)
		.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
		.accessibilityIdentifier("skill-editor-instructions")
	}
}

