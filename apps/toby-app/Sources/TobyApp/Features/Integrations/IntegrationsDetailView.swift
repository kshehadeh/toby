import SwiftUI

struct IntegrationsDetailView: View {
	@Bindable var store: ConfigureStore

	var body: some View {
		VStack(spacing: 0) {
			if store.isLoading && store.tree == nil {
				ProgressView("Loading integrations…")
					.frame(maxWidth: .infinity, maxHeight: .infinity)
			} else if let errorMessage = store.errorMessage, store.tree == nil {
				ContentUnavailableView {
					Label("Integrations unavailable", systemImage: "exclamationmark.triangle")
				} description: {
					Text(errorMessage)
				}
				.frame(maxWidth: .infinity, maxHeight: .infinity)
			} else if let section = store.selectedSection {
				IntegrationDetailContent(store: store, section: section)
			} else {
				Text("Select an integration")
					.foregroundStyle(SettingsDesign.rowDescription)
					.frame(maxWidth: .infinity, maxHeight: .infinity)
			}
		}
		.frame(maxWidth: .infinity, maxHeight: .infinity)
		.background(SettingsDesign.canvasBackground)
	}
}
