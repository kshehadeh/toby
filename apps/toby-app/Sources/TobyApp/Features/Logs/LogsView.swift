import SwiftUI

struct LogsView: View {
	@Bindable var store: LogsStore

	var body: some View {
		NavigationSplitView {
			LogsSidebarView(store: store)
				.navigationSplitViewColumnWidth(min: 220, ideal: 260, max: 300)
				.toolbar(removing: .sidebarToggle)
				.toolbar {
					ToolbarItem(placement: .confirmationAction) {
						Button {} label: {
							Image(systemName: "doc.text")
								.foregroundStyle(.clear)
						}
						.disabled(true)
						.accessibilityHidden(true)
					}
				}
		} detail: {
			LogsDetailView(store: store)
		}
		.toolbarBackground(.visible)
		.frame(minWidth: 860, minHeight: 560)
		.task {
			store.refreshAvailableLogs()
			if let first = store.availableLogs.first {
				store.selectLog(first)
			}
		}
		.onDisappear {
			store.stopPolling()
		}
	}
}
