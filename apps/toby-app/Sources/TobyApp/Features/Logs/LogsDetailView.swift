import SwiftUI

struct LogsDetailView: View {
	@Bindable var store: LogsStore

	var body: some View {
		Group {
			switch store.selection {
			case let .raw(log):
				LogsRawDetailView(store: store, log: log)

			case let .source(source):
				LogsSourceDetailView(store: store, source: source)

			case nil:
				ContentUnavailableView {
					Label("No log selected", systemImage: "doc.text")
				} description: {
					Text("Select a log from the sidebar to view its contents.")
				}
				.frame(maxWidth: .infinity, maxHeight: .infinity)
				.background(SettingsDesign.canvasBackground)
			}
		}
	}
}

struct LogsRawDetailView: View {
	@Bindable var store: LogsStore
	let log: LogsStore.LogDescriptor

	@State private var searchText = ""

	private var filteredContent: String {
		Self.filterLines(store.content, matching: searchText)
	}

	private var hasActiveSearch: Bool {
		!searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
	}

	private var totalLineCount: Int {
		Self.lineCount(store.content)
	}

	private var filteredLineCount: Int {
		Self.lineCount(filteredContent)
	}

	var body: some View {
		VStack(alignment: .leading, spacing: 0) {
			LogsDetailHeader(
				log: log,
				filteredLineCount: hasActiveSearch ? filteredLineCount : nil,
				totalLineCount: hasActiveSearch ? totalLineCount : nil
			)
			Divider()
				.background(AppTheme.separator)

			LogsSearchField(
				text: $searchText,
				placeholder: "Filter lines…"
			)
			.padding(.horizontal, 16)
			.padding(.vertical, 10)
			.background(AppTheme.panelBackground)

			Divider()
				.background(AppTheme.separator)

			if store.content.isEmpty {
				ContentUnavailableView {
					Label("Empty log", systemImage: "doc.text")
				} description: {
					Text("This log file has no content yet.")
				}
				.frame(maxWidth: .infinity, maxHeight: .infinity)
			} else if hasActiveSearch && filteredContent.isEmpty {
				ContentUnavailableView {
					Label("No matches", systemImage: "magnifyingglass")
				} description: {
					Text("No lines match “\(searchText.trimmingCharacters(in: .whitespacesAndNewlines))”.")
				}
				.frame(maxWidth: .infinity, maxHeight: .infinity)
			} else {
				LogTextView(text: filteredContent)
					.frame(maxWidth: .infinity, maxHeight: .infinity)
					.clipped()
			}
		}
		.background(SettingsDesign.canvasBackground)
		.onChange(of: log.id) { _, _ in
			searchText = ""
		}
	}

	/// Case-insensitive line filter. Empty query returns the original text unchanged.
	static func filterLines(_ content: String, matching query: String) -> String {
		let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return content }

		let needle = trimmed.lowercased()
		var kept: [Substring] = []
		content.enumerateLines { line, _ in
			if line.lowercased().contains(needle) {
				kept.append(Substring(line))
			}
		}
		guard !kept.isEmpty else { return "" }
		return kept.joined(separator: "\n") + "\n"
	}

	static func lineCount(_ content: String) -> Int {
		guard !content.isEmpty else { return 0 }
		var count = 0
		content.enumerateLines { _, _ in count += 1 }
		// enumerateLines skips a final empty line after trailing \n; for "a\nb\n" that's 2.
		return count
	}
}

struct LogsDetailHeader: View {
	let log: LogsStore.LogDescriptor
	var filteredLineCount: Int? = nil
	var totalLineCount: Int? = nil

	var body: some View {
		VStack(alignment: .leading, spacing: 2) {
			Text(log.displayName)
				.font(.headline)
				.foregroundStyle(AppTheme.primaryText)
			Text(subtitle)
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

	private var subtitle: String {
		if let filteredLineCount, let totalLineCount {
			return "\(filteredLineCount) of \(totalLineCount) lines · \(log.url.path)"
		}
		return log.url.path
	}
}
