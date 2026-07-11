import SwiftUI

struct LogsView: View {
	@Bindable var store: LogsStore
	var tobyDirectory: String?

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
							if let path = store.logFilePath {
								// Select the log file inside its folder (opens Finder there).
								RevealInFinder.reveal(path: path)
							} else if let dir = store.logDirectoryPath {
								RevealInFinder.reveal(path: dir)
							}
						} label: {
							Image(systemName: "folder")
						}
						.help("Show log folder in Finder")
						.accessibilityLabel("Show log in Finder")
						.disabled(store.logFilePath == nil && store.logDirectoryPath == nil)

						Button {
							store.refreshFromDisk()
						} label: {
							Image(systemName: "arrow.clockwise")
						}
						.help("Reload logs from disk")
						.accessibilityLabel("Refresh logs")
					}
				}
		}
		.toolbarBackground(.visible)
		.frame(minWidth: 860, minHeight: 560)
		.task {
			refreshFromServerDirectory()
		}
		.onChange(of: tobyDirectory) { _, _ in
			refreshFromServerDirectory()
		}
		.onDisappear {
			store.stopPolling()
		}
	}

	private func refreshFromServerDirectory() {
		store.setDirectory(path: tobyDirectory)
		if store.selection == nil, let first = store.availableLogs.first {
			store.selectLog(first)
		}
	}
}
