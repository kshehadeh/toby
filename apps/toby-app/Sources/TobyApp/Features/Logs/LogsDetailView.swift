import SwiftUI

struct LogsDetailView: View {
	@Bindable var store: LogsStore

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			if let log = store.selectedLog {
				LogsDetailHeader(log: log)
				Divider()
					.background(AppTheme.separator)
				LogTextView(text: store.content)
					.frame(maxWidth: .infinity, maxHeight: .infinity)
					.clipped()
			} else {
				ContentUnavailableView {
					Label("No log selected", systemImage: "doc.text")
				} description: {
					Text("Select a log from the sidebar to view its contents.")
				}
			}
		}
		.background(SettingsDesign.canvasBackground)
	}
}

struct LogsDetailHeader: View {
	let log: LogsStore.LogDescriptor

	var body: some View {
		VStack(alignment: .leading, spacing: 2) {
			Text(log.displayName)
				.font(.headline)
				.foregroundStyle(AppTheme.primaryText)
			Text(log.url.path)
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)
				.lineLimit(1)
				.truncationMode(.middle)
		}
		.padding(.horizontal, 16)
		.padding(.vertical, 10)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(AppTheme.panelBackground)
	}
}
