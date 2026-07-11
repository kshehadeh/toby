import SwiftUI

struct LogsSourceDetailView: View {
	@Bindable var store: LogsStore
	let source: String

	@State private var searchText = ""

	private var totalCount: Int {
		store.entries(forSource: source).count
	}

	private var filteredCount: Int {
		store.entries(forSource: source, matching: searchText).count
	}

	private var groups: [(level: String, entries: [UnifiedLogEntry])] {
		store.entriesByLevel(forSource: source, matching: searchText)
	}

	private var hasActiveSearch: Bool {
		!searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			LogsSourceDetailHeader(
				source: source,
				entryCount: filteredCount,
				totalCount: hasActiveSearch ? totalCount : nil
			)
			Divider()
				.background(AppTheme.separator)

			LogsSearchField(text: $searchText)
				.padding(.horizontal, 16)
				.padding(.vertical, 10)
				.background(AppTheme.panelBackground)

			Divider()
				.background(AppTheme.separator)

			if totalCount == 0 {
				ContentUnavailableView {
					Label("No entries", systemImage: "tray")
				} description: {
					Text("No log entries for this source in the last \(LogsStore.maxTailLines) lines.")
				}
				.frame(maxWidth: .infinity, maxHeight: .infinity)
			} else if filteredCount == 0 {
				ContentUnavailableView {
					Label("No matches", systemImage: "magnifyingglass")
				} description: {
					Text("No entries match “\(searchText.trimmingCharacters(in: .whitespacesAndNewlines))”.")
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
				.fill(Color.white.opacity(0.06))
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
	/// When non-nil, shown as "N of M entries" during an active search.
	var totalCount: Int? = nil

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
		if let totalCount {
			return "\(entryCount) of \(totalCount) \(totalCount == 1 ? "entry" : "entries") · last \(LogsStore.maxTailLines) lines · source “\(source)”"
		}
		return "\(entryCount) \(noun) · last \(LogsStore.maxTailLines) lines · source “\(source)”"
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
							.fill(Color.white.opacity(0.08))
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
					.textSelection(.enabled)
					.frame(maxWidth: .infinity, alignment: .leading)
					.padding(10)
					.background(
						RoundedRectangle(cornerRadius: 8)
							.fill(Color.black.opacity(0.28))
					)
			}
		}
		.padding(12)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(
			RoundedRectangle(cornerRadius: 10)
				.fill(AppTheme.elevatedBackground.opacity(0.55))
		)
		.overlay(
			RoundedRectangle(cornerRadius: 10)
				.strokeBorder(AppTheme.separator, lineWidth: 1)
		)
	}
}
