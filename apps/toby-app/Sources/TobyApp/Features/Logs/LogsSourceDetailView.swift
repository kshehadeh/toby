import SwiftUI

struct LogsSourceDetailView: View {
	@Bindable var store: LogsStore
	let source: String

	@State private var searchText = ""

	private var groups: [(level: String, entries: [UnifiedLogEntry])] {
		store.entriesByLevel()
	}

	private var hasActiveSearch: Bool {
		!store.searchQuery.isEmpty
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			LogsSourceDetailHeader(
				source: source,
				entryCount: store.entries.count,
				matched: store.matched,
				loadedLimit: store.loadedLimit
			)
			Divider()
				.background(AppTheme.separator)

			if store.showsFilterBar {
				LogsFilterBar(store: store)
				Divider()
					.background(AppTheme.separator)
			}

			LogsSearchField(text: $searchText)
				.padding(.horizontal, 16)
				.padding(.vertical, 10)
				.background(AppTheme.panelBackground)
				.onChange(of: searchText) { _, newValue in
					// Debounce lightly via Task — store coalesces identical queries.
					store.setSearchQuery(newValue)
				}

			Divider()
				.background(AppTheme.separator)

			if store.canLoadMore {
				LogsLoadMoreBar(store: store)
				Divider()
					.background(AppTheme.separator)
			}

			if let errorMessage = store.errorMessage, store.entries.isEmpty {
				ContentUnavailableView {
					Label("Couldn’t load logs", systemImage: "exclamationmark.triangle")
				} description: {
					Text(errorMessage)
				}
				.frame(maxWidth: .infinity, maxHeight: .infinity)
			} else if store.entries.isEmpty {
				ContentUnavailableView {
					Label("No entries", systemImage: "tray")
				} description: {
					if hasActiveSearch || store.filterLevel != nil || store.filterCategory != nil || store.filterType != nil {
						Text("No entries match the current filters.")
					} else {
						Text("No log entries for this source.")
					}
				}
				.frame(maxWidth: .infinity, maxHeight: .infinity)
			} else {
				ScrollView {
					LazyVStack(alignment: .leading, spacing: 12) {
						ForEach(groups, id: \.level) { group in
							LogLevelSection(
								level: group.level,
								entries: group.entries,
								forceExpanded: hasActiveSearch
							)
						}
					}
					.padding(16)
				}
			}
		}
		.background(SettingsDesign.canvasBackground)
		.onChange(of: source) { _, _ in
			searchText = ""
		}
		.onAppear {
			searchText = store.searchQuery
		}
	}
}

struct LogsFilterBar: View {
	@Bindable var store: LogsStore

	var body: some View {
		HStack(spacing: 12) {
			if store.facets.levels.count > 1 || store.filterLevel != nil {
				LogsFacetMenu(
					title: "Level",
					selection: store.filterLevel,
					options: store.facets.levels,
					displayName: { UnifiedLogEntry.displayName(forLevel: $0) },
					onSelect: { store.setFilterLevel($0) }
				)
			}
			if store.facets.categories.count > 1 || store.filterCategory != nil {
				LogsFacetMenu(
					title: "Category",
					selection: store.filterCategory,
					options: store.facets.categories,
					displayName: { $0 },
					onSelect: { store.setFilterCategory($0) }
				)
			}
			if store.facets.types.count > 1 || store.filterType != nil {
				LogsFacetMenu(
					title: "Type",
					selection: store.filterType,
					options: store.facets.types,
					displayName: { $0 },
					onSelect: { store.setFilterType($0) }
				)
			}
			Spacer(minLength: 0)
		}
		.padding(.horizontal, 16)
		.padding(.vertical, 8)
		.background(AppTheme.panelBackground)
	}
}

struct LogsFacetMenu: View {
	let title: String
	let selection: String?
	let options: [LogFacetBucket]
	let displayName: (String) -> String
	let onSelect: (String?) -> Void

	var body: some View {
		Menu {
			Button("Any \(title.lowercased())") {
				onSelect(nil)
			}
			Divider()
			ForEach(options) { bucket in
				Button {
					onSelect(bucket.name)
				} label: {
					if selection == bucket.name {
						Label("\(displayName(bucket.name)) (\(bucket.count))", systemImage: "checkmark")
					} else {
						Text("\(displayName(bucket.name)) (\(bucket.count))")
					}
				}
			}
		} label: {
			HStack(spacing: 4) {
				Text(selection.map(displayName) ?? title)
					.font(.caption.weight(.medium))
				Image(systemName: "chevron.down")
					.font(.system(size: 9, weight: .semibold))
			}
			.foregroundStyle(selection == nil ? AppTheme.secondaryText : AppTheme.primaryText)
			.padding(.horizontal, 8)
			.padding(.vertical, 5)
			.background(
				RoundedRectangle(cornerRadius: 6)
					.fill(AppTheme.elevatedBackground)
			)
			.overlay(
				RoundedRectangle(cornerRadius: 6)
					.strokeBorder(AppTheme.separator, lineWidth: 1)
			)
		}
		.menuStyle(.borderlessButton)
	}
}

struct LogsSearchField: View {
	@Binding var text: String
	var placeholder: String = "Filter by message, category, type, data…"

	var body: some View {
		HStack(spacing: 8) {
			Image(systemName: "magnifyingglass")
				.foregroundStyle(AppTheme.tertiaryText)
				.font(.system(size: 13, weight: .medium))
			TextField(placeholder, text: $text)
				.textFieldStyle(.plain)
				.font(.callout)
				.foregroundStyle(AppTheme.primaryText)
			if !text.isEmpty {
				Button {
					text = ""
				} label: {
					Image(systemName: "xmark.circle.fill")
						.foregroundStyle(AppTheme.tertiaryText)
						.font(.system(size: 13))
				}
				.buttonStyle(.plain)
				.accessibilityLabel("Clear search")
			}
		}
		.padding(.horizontal, 10)
		.padding(.vertical, 7)
		.background(
			RoundedRectangle(cornerRadius: 8)
				.fill(AppTheme.elevatedBackground)
		)
		.overlay(
			RoundedRectangle(cornerRadius: 8)
				.strokeBorder(AppTheme.separator, lineWidth: 1)
		)
	}
}

struct LogsSourceDetailHeader: View {
	let source: String
	let entryCount: Int
	var matched: Int = 0
	var loadedLimit: Int = LogsStore.pageSize

	var body: some View {
		VStack(alignment: .leading, spacing: 2) {
			Text(UnifiedLogEntry.displayName(forSource: source))
				.font(.headline)
				.foregroundStyle(AppTheme.primaryText)
			Text(subtitle)
				.font(.caption)
				.foregroundStyle(AppTheme.tertiaryText)
				.lineLimit(1)
		}
		.padding(.horizontal, 16)
		.padding(.vertical, 10)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(AppTheme.panelBackground)
	}

	private var subtitle: String {
		let noun = entryCount == 1 ? "entry" : "entries"
		if matched > entryCount {
			return "\(entryCount) of \(matched) \(matched == 1 ? "entry" : "entries") · source “\(source)”"
		}
		return "\(entryCount) \(noun) · source “\(source)”"
	}
}

struct LogLevelSection: View {
	let level: String
	let entries: [UnifiedLogEntry]
	var forceExpanded: Bool = false

	@State private var isExpanded: Bool

	init(level: String, entries: [UnifiedLogEntry], forceExpanded: Bool = false) {
		self.level = level
		self.entries = entries
		self.forceExpanded = forceExpanded
		// Expand error/warn by default; collapse info/debug when large
		let defaultExpanded = level == "error" || level == "warn" || entries.count <= 40
		_isExpanded = State(initialValue: forceExpanded || defaultExpanded)
	}

	var body: some View {
		DisclosureGroup(isExpanded: expandedBinding) {
			VStack(alignment: .leading, spacing: 8) {
				ForEach(entries) { entry in
					LogEntryRow(entry: entry)
				}
			}
			.padding(.top, 8)
		} label: {
			HStack(spacing: 8) {
				Circle()
					.fill(UnifiedLogEntry.tint(forLevel: level))
					.frame(width: 8, height: 8)
				Text(UnifiedLogEntry.displayName(forLevel: level))
					.font(.subheadline.weight(.semibold))
					.foregroundStyle(AppTheme.primaryText)
				Text("\(entries.count)")
					.font(.caption.weight(.medium))
					.foregroundStyle(AppTheme.tertiaryText)
					.padding(.horizontal, 6)
					.padding(.vertical, 2)
					.background(
						Capsule()
							.fill(AppTheme.selection)
					)
				Spacer(minLength: 0)
			}
		}
		.tint(AppTheme.secondaryText)
	}

	private var expandedBinding: Binding<Bool> {
		Binding(
			get: { forceExpanded || isExpanded },
			set: { isExpanded = $0 }
		)
	}
}

struct LogEntryRow: View {
	let entry: UnifiedLogEntry
	/// Rebuild attributed JSON when appearance flips so syntax colors re-resolve.
	@Environment(\.colorScheme) private var colorScheme

	var body: some View {
		VStack(alignment: .leading, spacing: 6) {
			HStack(alignment: .firstTextBaseline, spacing: 10) {
				Text(entry.formattedTime)
					.font(.system(.caption, design: .monospaced))
					.foregroundStyle(AppTheme.secondaryText)
					.frame(minWidth: 72, alignment: .leading)

				Text("\(entry.category) · \(entry.type)")
					.font(.callout.weight(.medium))
					.foregroundStyle(AppTheme.primaryText)
					.lineLimit(2)

				Spacer(minLength: 0)
			}

			if let message = entry.message, !message.isEmpty {
				Text(message)
					.font(.callout)
					.foregroundStyle(AppTheme.primaryText)
					.textSelection(.enabled)
					.frame(maxWidth: .infinity, alignment: .leading)
			}

			if let dataPretty = entry.dataPretty, !dataPretty.isEmpty {
				Text(JSONPrettyPrinter.attributedString(prettyJSON: dataPretty))
					.id(colorScheme)
					.textSelection(.enabled)
					.frame(maxWidth: .infinity, alignment: .leading)
					.padding(10)
					.background(
						RoundedRectangle(cornerRadius: 8)
							.fill(Color(nsColor: .tobyLogCodeBackground))
					)
			}
		}
		.padding(12)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(
			RoundedRectangle(cornerRadius: 10)
				.fill(AppTheme.elevatedBackground)
		)
		.overlay(
			RoundedRectangle(cornerRadius: 10)
				.strokeBorder(AppTheme.separator, lineWidth: 1)
		)
	}
}
