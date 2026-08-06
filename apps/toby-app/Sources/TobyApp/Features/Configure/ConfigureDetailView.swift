import SwiftUI

struct ConfigureDetailView: View {
	@Bindable var store: ConfigureStore

	var body: some View {
		ScrollView {
			VStack(alignment: .leading, spacing: 20) {
				if store.isLoading && store.settingsSections.isEmpty {
					ConfigureDetailSkeletonView()
				} else if let errorMessage = store.errorMessage, store.settingsSections.isEmpty {
					ContentUnavailableView {
						Label("Configuration unavailable", systemImage: "exclamationmark.triangle")
					} description: {
						Text(errorMessage)
					}
				} else if let section = store.settingsSelectedSection {
					ConfigureSectionDetailView(store: store, section: section)
				} else if store.sectionDetailLoading {
					ConfigureDetailSkeletonView()
				} else {
					Text("Select a section")
						.foregroundStyle(SettingsDesign.rowDescription)
				}

				if let errorMessage = store.errorMessage, !store.settingsSections.isEmpty {
					InlineStatusMessage(message: errorMessage, tone: .error, font: .caption)
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
