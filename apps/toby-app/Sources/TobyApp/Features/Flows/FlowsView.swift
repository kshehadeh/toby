import SwiftUI

struct FlowsView: View {
	@Bindable var store: FlowsStore

	var body: some View {
		FlowsDetailView(store: store)
			.toolbarBackground(.visible)
			.background(SettingsDesign.canvasBackground)
			.task {
				await store.ensureLoaded()
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
