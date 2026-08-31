import SwiftUI

struct IntegrationsSidebarView: View {
	@Bindable var store: ConfigureStore

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			Button {
				store.selectIntegrationHome()
			} label: {
				HStack(spacing: 8) {
					Image(systemName: "square.grid.2x2")
						.font(.system(size: 12, weight: .semibold))
						.foregroundStyle(store.selectedNavKey == nil ? AppTheme.accent : AppTheme.tertiaryText)
						.frame(width: 16)
					Text("Integrations")
						.font(.caption.weight(.medium))
						.foregroundStyle(store.selectedNavKey == nil ? AppTheme.primaryText : AppTheme.secondaryText)
					Spacer(minLength: 0)
				}
				.padding(.horizontal, 10)
				.padding(.vertical, 8)
				.contentShape(Rectangle())
				.background(
					RoundedRectangle(cornerRadius: 8)
						.fill(store.selectedNavKey == nil ? Color.white.opacity(0.10) : Color.clear)
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
