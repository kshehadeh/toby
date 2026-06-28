import SwiftUI

struct ConfigureSidebarView: View {
	@Bindable var store: ConfigureStore

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			Text("Settings")
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)
				.padding(.horizontal, 8)
				.padding(.top, 10)
			ScrollView {
				VStack(alignment: .leading, spacing: 2) {
					if store.isLoading && store.settingsSections.isEmpty {
						ConfigureSidebarSkeletonView()
					} else {
						ForEach(store.settingsSidebarTree) { node in
							ConfigureSidebarNodeView(store: store, node: node)
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
