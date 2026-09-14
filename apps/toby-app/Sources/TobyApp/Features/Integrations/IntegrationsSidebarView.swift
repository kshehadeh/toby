import SwiftUI

struct IntegrationsSidebarView: View {
	@Bindable var store: ConfigureStore

	var body: some View {
		FeatureBrowserList(
			isLoading: store.isLoading,
			isEmpty: store.integrationSections.isEmpty,
			loadingText: "Loading integrations…",
			emptyText: "No integrations",
			onClearSelection: { store.selectIntegrationHome() }
		) {
			ForEach(store.integrationSections) { section in
				Button {
					store.selectSection(section.navKey ?? section.key)
				} label: {
					IntegrationSidebarRow(
						section: section,
						isSelected: store.selectedNavKey == (section.navKey ?? section.key),
					)
				}
				.buttonStyle(.plain)
			}
		}
	}
}
