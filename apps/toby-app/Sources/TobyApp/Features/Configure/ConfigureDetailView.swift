import SwiftUI

struct ConfigureDetailView: View {
	@Bindable var store: ConfigureStore

	var body: some View {
		Group {
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
				ContentUnavailableView {
					Label("Select a section", systemImage: "sidebar.leading")
				} description: {
					Text("Choose an item in the sidebar to view and edit its settings.")
				}
			}
		}
	}
}
