import SwiftUI

struct MemoryEditorSheet: View {
	@Bindable var store: MemoriesStore

	private var title: String {
		store.editor?.isNew == true ? "New Memory" : "Edit Memory"
	}

	var body: some View {
		EditorSheet(
			title: title,
			isSaving: store.isSaving,
			canSave: store.editor?.canSave ?? false,
			isDirty: store.isEditorDirty,
			errorMessage: store.editorError,
			size: .compact,
			accessibilityIdentifier: "memory-editor-sheet",
			cancelAccessibilityIdentifier: "memory-editor-cancel",
			saveAccessibilityIdentifier: "memory-editor-save",
			onCancel: { store.cancelEditor() },
			onSave: { Task { await store.saveEditor() } }
		) {
			if store.editor != nil {
				editorForm
			}
		}
	}

	private var editorForm: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 16) {
				SkillSidebarField(
					title: "Subject",
					hint: "Optional label",
					placeholder: "Subject",
					accessibilityIdentifier: "memory-subject-field",
					text: draftBinding(\.subject)
				)
				SkillSidebarField(
					title: "Value",
					placeholder: "What should Toby remember?",
					axis: .vertical,
					accessibilityIdentifier: "memory-value-field",
					text: draftBinding(\.value)
				)
				editorInlineRow("Type") {
					Picker("Type", selection: draftBinding(\.type)) {
						ForEach(MemoryField.memoryTypes, id: \.self) { Text($0).tag($0) }
					}
					.labelsHidden()
					.pickerStyle(.menu)
					.frame(width: 180)
					.accessibilityIdentifier("memory-type-picker")
				}
				editorInlineRow("Sensitivity") {
					Picker("Sensitivity", selection: draftBinding(\.sensitivity)) {
						ForEach(MemoryField.memorySensitivities, id: \.self) { Text($0).tag($0) }
					}
					.labelsHidden()
					.pickerStyle(.menu)
					.frame(width: 180)
					.accessibilityIdentifier("memory-sensitivity-picker")
				}
				editorInlineRow("Visibility") {
					Picker("Visibility", selection: draftBinding(\.visibility)) {
						ForEach(MemoryField.memoryVisibilities, id: \.self) { Text($0).tag($0) }
					}
					.labelsHidden()
					.pickerStyle(.menu)
					.frame(width: 180)
					.accessibilityIdentifier("memory-visibility-picker")
				}
				editorInlineRow("Confidence") {
					HStack(spacing: 8) {
						Text(String(format: "%.0f%%", (store.editor?.confidence ?? 1) * 100))
							.font(.system(size: 11, weight: .medium))
							.foregroundStyle(AppTheme.secondaryText)
							.frame(width: 36, alignment: .trailing)
							.monospacedDigit()
						Slider(value: draftBinding(\.confidence), in: 0...1, step: 0.05)
							.frame(width: 140)
							.accessibilityIdentifier("memory-confidence-slider")
					}
				}
			}
			.padding(20)
			.frame(maxWidth: .infinity, alignment: .leading)
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.scrollBounceBehavior(.basedOnSize)
		.accessibilityIdentifier("memory-editor-form")
	}

	private func editorInlineRow<Control: View>(
		_ label: String,
		@ViewBuilder control: () -> Control
	) -> some View {
		HStack(alignment: .center, spacing: 16) {
			Text(label)
				.font(.system(size: 13, weight: .semibold))
				.foregroundStyle(SettingsDesign.rowTitle)
				.fixedSize()
			Spacer(minLength: 0)
			control()
		}
		.frame(minHeight: SettingsDesign.formRowHeight)
	}

	private func draftBinding<Value>(_ keyPath: WritableKeyPath<MemoryEditorDraft, Value>) -> Binding<Value> {
		editorDraftFieldBinding($store.editor, keyPath, fallback: .blank())
	}
}
