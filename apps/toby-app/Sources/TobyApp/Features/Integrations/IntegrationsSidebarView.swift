import SwiftUI

struct IntegrationsSidebarView: View {
	@Bindable var store: ConfigureStore

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			Button {
				store.selectIntegrationHome()
			} label: {
				SidebarListHeader(
					title: "Integrations",
					systemImage: "square.grid.2x2",
					isSelected: store.selectedNavKey == nil,
				)
			}
			.buttonStyle(.plain)
			.accessibilityIdentifier("integrations-home-button")
			.accessibilityAddTraits(store.selectedNavKey == nil ? [.isSelected] : [])
			.padding(.horizontal, 10)
			.padding(.top, 10)

			ScrollView {
				VStack(alignment: .leading, spacing: 2) {
					if store.isLoading && store.integrationSections.isEmpty {
						Text("Loading integrations…")
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(10)
					} else if store.integrationSections.isEmpty {
						Text("No integrations")
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(10)
					} else {
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
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(10)
			}
			.background(AppTheme.sidebarBackground)
		}
	}
}
