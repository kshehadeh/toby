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
	}
}
