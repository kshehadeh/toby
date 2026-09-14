import SwiftUI

struct FlowsDetailView: View {
	@Bindable var store: FlowsStore

	var body: some View {
		Group {
			if store.editor != nil {
				FlowEditorView(
					store: store,
					draft: Binding(
						get: { store.editor ?? .blank() },
						set: { store.editor = $0 }
					)
				)
			} else if store.isListLoading && store.flows.isEmpty {
				ProgressView("Loading flows…")
					.frame(maxWidth: .infinity, maxHeight: .infinity)
			} else if let errorMessage = store.errorMessage, store.flows.isEmpty {
				ContentUnavailableView {
					Label("Flows unavailable", systemImage: "exclamationmark.triangle")
				} description: {
					Text(errorMessage)
				}
			} else if let flow = store.selectedFlow {
				FlowDetailContent(store: store, flow: flow)
			} else {
				FeatureBrowserPlaceholder(
					systemImage: DetailRoute.flows.systemImage,
					prompt: "Select a flow",
					onCreate: { Task { await store.startCreate() } },
					createAccessibilityIdentifier: "flows-empty-state"
				)
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(SettingsDesign.canvasBackground)
	}
}
