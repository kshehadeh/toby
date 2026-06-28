import SwiftUI

struct LogsSidebarView: View {
	@Bindable var store: LogsStore

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			Text("Logs")
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)
				.padding(.horizontal, 8)
				.padding(.top, 10)

			ScrollView {
				VStack(alignment: .leading, spacing: 2) {
					if store.availableLogs.isEmpty {
						Text("No logs found")
							.font(.caption)
							.foregroundStyle(AppTheme.tertiaryText)
							.padding(10)
					} else {
						ForEach(store.availableLogs) { log in
							Button {
								store.selectLog(log)
							} label: {
								LogSidebarRow(
									name: log.displayName,
									fileName: log.fileName,
									isSelected: store.selectedLog == log,
								)
							}
							.buttonStyle(.plain)
						}
					}
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(10)
			}
		}
		.background(AppTheme.sidebarBackground)
	}
}

struct LogSidebarRow: View {
	let name: String
	let fileName: String
	let isSelected: Bool

	var body: some View {
		HStack(spacing: 12) {
			Image(systemName: "doc.text.fill")
				.font(.system(size: 14, weight: .semibold))
				.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.tertiaryText)
				.frame(width: 20, height: 20)
			VStack(alignment: .leading, spacing: 2) {
				Text(name)
					.font(.callout.weight(.medium))
					.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
					.lineLimit(1)
				Text(fileName)
					.font(.caption2)
					.foregroundStyle(AppTheme.tertiaryText)
					.lineLimit(1)
			}
			Spacer(minLength: 0)
		}
		.padding(.vertical, 8)
		.padding(.horizontal, 10)
		.contentShape(Rectangle())
		.background(
			RoundedRectangle(cornerRadius: 8)
				.fill(isSelected ? Color.white.opacity(0.10) : Color.clear)
		)
	}
}
