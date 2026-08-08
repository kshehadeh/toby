import Foundation

@Observable
@MainActor
final class LogsStore {
	/// Page size for initial load and each “Load more”.
	static let pageSize = 100

	/// Selected source in the sidebar (`nil` = none).
	var selectedSource: String?
	/// Entries for the current filters (newest first, already filtered by server).
	var entries: [UnifiedLogEntry] = []
	var facets: LogFacets = .empty
	/// Absolute path of the unified log file (from API).
	var logPath: String?
	var isLoading = false
	var errorMessage: String?
	var hasLoadedOnce = false

	/// Optional facet filters applied as query params.
	var filterLevel: String?
	var filterCategory: String?
	var filterType: String?
	/// Free-text search (`q` query param).
	var searchQuery: String = ""

	/// Current limit window sent to the API.
	var loadedLimit: Int = LogsStore.pageSize
	var matched: Int = 0
	var hasMore = false

	var canLoadMore: Bool { hasMore }

	/// Sources for the sidebar (from facets).
	var discoveredSources: [String] {
		facets.sources.map(\.name)
	}

	/// Whether the level/category/type filter menus should be shown.
	var showsFilterBar: Bool {
		facets.levels.count > 1 || filterLevel != nil
			|| facets.categories.count > 1 || filterCategory != nil
			|| facets.types.count > 1 || filterType != nil
	}

	private var pollTask: Task<Void, Never>?
	private var fetchGeneration = 0
	private let client: LogsFetching

	init(client: LogsFetching = TobyClient()) {
		self.client = client
	}

	/// Clears log state after a Toby home directory switch.
	func resetForHomeSwitch() {
		stopPolling()
		selectedSource = nil
		entries = []
		facets = .empty
		logPath = nil
		isLoading = false
		errorMessage = nil
		hasLoadedOnce = false
		filterLevel = nil
		filterCategory = nil
		filterType = nil
		searchQuery = ""
		loadedLimit = Self.pageSize
		matched = 0
		hasMore = false
		fetchGeneration += 1
	}

	func selectSource(_ source: String) {
		if selectedSource == source { return }
		selectedSource = source
		// Reset expansion and secondary filters when switching sources.
		filterLevel = nil
		filterCategory = nil
		filterType = nil
		searchQuery = ""
		loadedLimit = Self.pageSize
		Task { await refresh() }
	}

	func setSearchQuery(_ query: String) {
		let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
		guard searchQuery != trimmed else { return }
		searchQuery = trimmed
		loadedLimit = Self.pageSize
		Task { await refresh() }
	}

	func setFilterLevel(_ level: String?) {
		let next = level?.trimmingCharacters(in: .whitespacesAndNewlines)
		let normalized = (next?.isEmpty == false) ? next : nil
		guard filterLevel != normalized else { return }
		filterLevel = normalized
		loadedLimit = Self.pageSize
		Task { await refresh() }
	}

	func setFilterCategory(_ category: String?) {
		let next = category?.trimmingCharacters(in: .whitespacesAndNewlines)
		let normalized = (next?.isEmpty == false) ? next : nil
		guard filterCategory != normalized else { return }
		filterCategory = normalized
		loadedLimit = Self.pageSize
		Task { await refresh() }
	}

	func setFilterType(_ type: String?) {
		let next = type?.trimmingCharacters(in: .whitespacesAndNewlines)
		let normalized = (next?.isEmpty == false) ? next : nil
		guard filterType != normalized else { return }
		filterType = normalized
		loadedLimit = Self.pageSize
		Task { await refresh() }
	}

	func loadMoreLines() {
		guard canLoadMore else { return }
		loadedLimit += Self.pageSize
		Task { await refresh() }
	}

	/// Refresh from the daemon; also used by the toolbar button.
	func refreshFromDisk() {
		Task { await refresh() }
	}

	func startPolling() {
		guard pollTask == nil else { return }
		pollTask = Task { [weak self] in
			while !Task.isCancelled {
				try? await Task.sleep(nanoseconds: 1_000_000_000)
				guard let self else { return }
				await self.refresh(isPoll: true)
			}
		}
	}

	func stopPolling() {
		pollTask?.cancel()
		pollTask = nil
	}

	/// Entries for the selected source already match server-side; grouping helper for UI.
	func entriesByLevel() -> [(level: String, entries: [UnifiedLogEntry])] {
		var buckets: [String: [UnifiedLogEntry]] = [:]
		for entry in entries {
			buckets[entry.level, default: []].append(entry)
		}
		return UnifiedLogEntry.levelOrder.compactMap { level in
			guard let list = buckets[level], !list.isEmpty else { return nil }
			// Server already returns newest first; preserve that within each level.
			return (level: level, entries: list)
		}
	}

	func entryCount(forSource source: String) -> Int {
		facets.sources.first(where: { $0.name == source })?.count ?? 0
	}

	func refresh(isPoll: Bool = false) async {
		if !isPoll {
			isLoading = true
		}
		fetchGeneration += 1
		let generation = fetchGeneration
		errorMessage = nil

		do {
			let response = try await client.fetchLogs(
				source: selectedSource,
				level: filterLevel,
				category: filterCategory,
				type: filterType,
				query: searchQuery.isEmpty ? nil : searchQuery,
				limit: loadedLimit
			)
			guard generation == fetchGeneration else { return }
			apply(response)
			hasLoadedOnce = true
			errorMessage = nil
		} catch {
			guard generation == fetchGeneration else { return }
			// Keep previous content on poll failures; surface error on first load or explicit refresh.
			if !isPoll || !hasLoadedOnce {
				errorMessage = error.localizedDescription
				hasLoadedOnce = true
			}
		}

		if !isPoll {
			isLoading = false
		}
	}

	/// Initial load + auto-select first source if needed.
	func ensureLoaded() async {
		startPolling()
		await refresh()
		if selectedSource == nil, let first = discoveredSources.first {
			selectedSource = first
			await refresh()
		}
	}

	// MARK: - Private

	private func apply(_ response: LogsListResponse) {
		logPath = response.logPath
		entries = response.entries
		facets = response.facets
		matched = response.matched
		hasMore = response.hasMore
		// Keep loadedLimit as requested; server may return fewer when exhausted.
	}
}

/// Protocol so tests can inject a fake client.
@MainActor
protocol LogsFetching {
	func fetchLogs(
		source: String?,
		level: String?,
		category: String?,
		type: String?,
		query: String?,
		limit: Int
	) async throws -> LogsListResponse
}

extension TobyClient: LogsFetching {}
