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
				.toolbar {
					ToolbarItemGroup(placement: .primaryAction) {
						Button {
							if let path = store.logPath {
								RevealInFinder.reveal(path: path)
							}
						} label: {
							Image(systemName: "folder")
						}
						.help("Show log file in Finder")
						.accessibilityLabel("Show log in Finder")
						.disabled(store.logPath == nil)

						Button {
							store.loadMoreLines()
						} label: {
							Image(systemName: "text.badge.plus")
						}
						.help("Load \(LogsStore.pageSize) older entries")
						.accessibilityLabel("Load more log lines")
						.disabled(!store.canLoadMore)

						Button {
							store.refreshFromDisk()
						} label: {
							Image(systemName: "arrow.clockwise")
						}
						.help("Reload logs from server")
						.accessibilityLabel("Refresh logs")
					}
				}
		}
		.toolbarBackground(.visible)
		.frame(minWidth: 860, minHeight: 560)
		.task {
			await store.ensureLoaded()
		}
		.onDisappear {
			store.stopPolling()
		}
	}
}
