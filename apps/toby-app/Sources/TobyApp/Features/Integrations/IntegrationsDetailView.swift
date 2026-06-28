import SwiftUI

struct IntegrationsDetailView: View {
	@Bindable var store: ConfigureStore

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 20) {
				if store.isLoading && store.tree == nil {
					ProgressView("Loading integrations…")
						.frame(maxWidth: .infinity, minHeight: 240)
				} else if let errorMessage = store.errorMessage, store.tree == nil {
					ContentUnavailableView {
						Label("Integrations unavailable", systemImage: "exclamationmark.triangle")
					} description: {
						Text(errorMessage)
					}
				} else if let section = store.selectedSection {
					ConfigureSectionDetailView(store: store, section: section)
				} else {
					Text("Select an integration")
						.foregroundStyle(SettingsDesign.rowDescription)
				}

				if let errorMessage = store.errorMessage, store.tree != nil {
					Text(errorMessage)
						.font(.caption)
						.foregroundStyle(.red)
				}
			}
			.frame(maxWidth: SettingsDesign.contentMaxWidth)
			.frame(maxWidth: .infinity)
			.padding(.horizontal, 32)
			.padding(.vertical, 28)
		}
		.background(SettingsDesign.canvasBackground)
	}
}
