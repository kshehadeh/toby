import SwiftUI

struct LogsDetailView: View {
	@Bindable var store: LogsStore

	var body: some View {
		Group {
			if let source = store.selectedSource {
				LogsSourceDetailView(store: store, source: source)
			} else if let errorMessage = store.errorMessage {
				ContentUnavailableView {
					Label("Couldn’t load logs", systemImage: "exclamationmark.triangle")
				} description: {
					Text(errorMessage)
					Text("Restart the Toby server from Server status, then refresh.")
						.font(.caption)
				}
				.frame(maxWidth: .infinity, maxHeight: .infinity)
				.background(SettingsDesign.canvasBackground)
			} else {
				ContentUnavailableView {
					Label("No source selected", systemImage: "tray.full")
				} description: {
					Text("Select a log source from the sidebar.")
				}
				.frame(maxWidth: .infinity, maxHeight: .infinity)
				.background(SettingsDesign.canvasBackground)
			}
		}
	}
}

/// Compact control to expand the log window by another page of older entries.
struct LogsLoadMoreBar: View {
	@Bindable var store: LogsStore

	var body: some View {
		HStack(spacing: 10) {
			Text(statusLabel)
				.font(.caption)
				.foregroundStyle(AppTheme.secondaryText)
			Spacer(minLength: 0)
			Button {
				store.loadMoreLines()
			} label: {
				Label("Load \(LogsStore.pageSize) more", systemImage: "arrow.up")
					.font(.caption.weight(.medium))
			}
			.buttonStyle(.borderless)
			.disabled(!store.canLoadMore)
			.help("Load \(LogsStore.pageSize) older entries from the log")
			.accessibilityLabel("Load more log lines")
		}
		.padding(.horizontal, 16)
		.padding(.vertical, 8)
		.background(AppTheme.panelBackground)
	}

	private var statusLabel: String {
		if store.matched > store.entries.count {
			return "Showing \(store.entries.count) of \(store.matched) matching"
		}
		return "Showing \(store.entries.count) matching"
	}
}
