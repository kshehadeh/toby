import SwiftUI

struct MemoriesWindowView: View {
	@Bindable var store: MemoriesStore

	var body: some View {
		NavigationSplitView {
			MemoriesSidebarView(store: store)
				.navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 300)
				.toolbar(removing: .sidebarToggle)
				.toolbar {
					ToolbarItem(placement: .confirmationAction) {
						Button {} label: {
							Image(systemName: "brain.head.profile")
								.foregroundStyle(.clear)
						}
						.disabled(true)
						.accessibilityHidden(true)
					}
				}
		} detail: {
			MemoriesView(store: store)
				.toolbar {
					ToolbarItem(placement: .primaryAction) {
						Button {
							Task { await store.load() }
						} label: {
							Image(systemName: "arrow.clockwise")
						}
						.help("Refresh memories")
						.disabled(store.isListLoading || store.isSaving)
						.accessibilityIdentifier("refresh-memories-button")
						.accessibilityLabel("Refresh memories")
					}
				}
		}
		.toolbarBackground(.visible)
		.frame(minWidth: 860, minHeight: 560)
	}
}
