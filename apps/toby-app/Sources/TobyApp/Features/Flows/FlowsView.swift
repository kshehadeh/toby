import SwiftUI

struct FlowsView: View {
	@Bindable var store: FlowsStore
	@State private var preferList = false
	@State private var showScriptTools = false
	@State private var scriptToolsStore = UserScriptToolsStore()

	private var hasSelection: Bool {
		store.selectedFlow != nil
	}

	private var flowEditorCanSave: Bool {
		guard let editor = store.editor else { return false }
		return !editor.nodes.isEmpty
			&& !editor.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
	}

	var body: some View {
		FeatureWorkspaceSplit(
			listTitle: "Flows",
			isShowingList: preferList || !hasSelection,
			onShowList: { preferList = true }
		) {
			FlowsSidebarView(store: store, showScriptTools: $showScriptTools)
		} detail: {
			FlowsDetailView(store: store)
		}
		.onChange(of: store.selectedFlowId) { _, id in
			if id != nil { preferList = false }
		}
		.onChange(of: store.editor != nil) { _, editing in
			if editing { preferList = false }
		}
		.task {
			await store.ensureLoaded()
		}
		.sheet(isPresented: $showScriptTools) {
			UserScriptToolsView(store: scriptToolsStore)
		}
		.sheet(item: editorSheetItem($store.editor, onDismiss: {
			store.cancelEditor()
		})) { _ in
			EditorSheet(
				title: store.editor?.isNew == true ? "New Flow" : "Edit Flow",
				isSaving: store.isSaving,
				canSave: flowEditorCanSave,
				isDirty: store.isEditorDirty,
				errorMessage: store.editorError,
				size: .wide,
				accessibilityIdentifier: "flow-editor-sheet",
				cancelAccessibilityIdentifier: "flow-editor-cancel",
				saveAccessibilityIdentifier: "flow-editor-save",
				onCancel: { store.cancelEditor() },
				onSave: { Task { await store.saveEditor() } }
			) {
				FlowEditorView(
					store: store,
					draft: editorDraftBinding($store.editor, fallback: .blank())
				)
			}
		}
		.sheet(isPresented: Binding(
			get: { store.selectedRunId != nil },
			set: { if !$0 { store.closeRunDetail() } }
		)) {
			FlowRunDetailView(
				run: store.selectedRunDetail,
				isLoading: store.isRunDetailLoading,
				error: store.runDetailError
			)
		}
		.sheet(isPresented: Binding(
			get: { store.showResultSheet },
			set: { if !$0 { store.closeResultSheet() } }
		)) {
			FlowResultSheet(result: store.lastRunResult) {
				store.closeResultSheet()
			}
		}
		.confirmationDialog(
			"Delete this flow?",
			isPresented: Binding(
				get: { store.pendingDeleteId != nil },
				set: { if !$0 { store.cancelDelete() } }
			),
			titleVisibility: .visible
		) {
			Button("Delete", role: .destructive) {
				if let id = store.pendingDeleteId {
					Task { await store.deleteFlow(id: id) }
				}
			}
			Button("Cancel", role: .cancel) {
				store.cancelDelete()
			}
		} message: {
			Text("This removes the flow definition. Run history is kept.")
		}
	}
}
