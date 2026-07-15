import SwiftUI

struct LogsSidebarView: View {
	@Bindable var store: LogsStore

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			ScrollView {
				VStack(alignment: .leading, spacing: 6) {
					SidebarSection(title: "Sources") {
						VStack(alignment: .leading, spacing: 2) {
							if store.discoveredSources.isEmpty {
								Text(sidebarEmptyMessage)
									.font(.caption)
									.foregroundStyle(AppTheme.tertiaryText)
									.padding(10)
							} else {
								ForEach(store.discoveredSources, id: \.self) { source in
									Button {
										store.selectSource(source)
									} label: {
										LogSourceSidebarRow(
											source: source,
											entryCount: store.entryCount(forSource: source),
											isSelected: store.selectedSource == source,
										)
									}
									.buttonStyle(.plain)
								}
							}
						}
					}
				}
				.frame(maxWidth: .infinity, alignment: .leading)
				.padding(.bottom, 10)
			}
		}
		.background(AppTheme.sidebarBackground)
	}

	private var sidebarEmptyMessage: String {
		if !store.hasLoadedOnce || store.isLoading {
			return "Loading…"
		}
		if store.errorMessage != nil {
			return "Couldn’t load sources"
		}
		return "No log sources yet"
	}
}

struct LogSourceSidebarRow: View {
	let source: String
	let entryCount: Int
	let isSelected: Bool

	var body: some View {
		HStack(spacing: 12) {
			Image(systemName: UnifiedLogEntry.systemImage(forSource: source))
				.font(.system(size: 14, weight: .semibold))
				.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.tertiaryText)
				.frame(width: 20, height: 20)
			VStack(alignment: .leading, spacing: 2) {
				Text(UnifiedLogEntry.displayName(forSource: source))
					.font(.callout.weight(.medium))
					.foregroundStyle(isSelected ? AppTheme.primaryText : AppTheme.secondaryText)
					.lineLimit(1)
				Text("\(entryCount) \(entryCount == 1 ? "entry" : "entries")")
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
