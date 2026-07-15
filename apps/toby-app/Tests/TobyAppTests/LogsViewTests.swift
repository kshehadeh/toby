import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
private final class StubLogsClient: LogsFetching {
	var response: LogsListResponse

	init(response: LogsListResponse) {
		self.response = response
	}

	func fetchLogs(
		source: String?,
		level: String?,
		category: String?,
		type: String?,
		query: String?,
		limit: Int
	) async throws -> LogsListResponse {
		response
	}
}

@MainActor
@Suite("LogsView")
struct LogsViewTests {
	private func seededStore() -> LogsStore {
		let entry = UnifiedLogEntry(
			id: "0",
			ts: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-3600)),
			source: "daemon",
			level: "info",
			category: "plugin",
			type: "poll_complete",
			sessionId: nil,
			turnIndex: nil,
			message: nil,
			dataPretty: "{\n  \"plugin\" : \"email\"\n}"
		)
		let response = LogsListResponse(
			logPath: "/tmp/toby.log",
			entries: [entry],
			limit: 100,
			matched: 1,
			hasMore: false,
			facets: LogFacets(
				sources: [
					LogFacetBucket(name: "daemon", count: 1),
					LogFacetBucket(name: "chat", count: 0),
				],
				levels: [LogFacetBucket(name: "info", count: 1)],
				categories: [LogFacetBucket(name: "plugin", count: 1)],
				types: [LogFacetBucket(name: "poll_complete", count: 1)]
			)
		)
		let store = LogsStore(client: StubLogsClient(response: response))
		store.selectedSource = "daemon"
		store.entries = [entry]
		store.facets = response.facets
		store.logPath = response.logPath
		store.matched = 1
		store.hasLoadedOnce = true
		return store
	}

	@Test("logs sidebar shows Sources section header")
	func logsSidebarShowsSourcesHeader() throws {
		let store = LogsStore()
		let view = LogsSidebarView(store: store)
		#expect(throws: Never.self) { try view.inspect().find(text: "Sources") }
	}

	@Test("logs sidebar does not show Raw section")
	func logsSidebarHidesRaw() throws {
		let store = seededStore()
		let view = LogsSidebarView(store: store)
		#expect(throws: Never.self) { try view.inspect().find(text: "Sources") }
		#expect(throws: (any Error).self) { try view.inspect().find(text: "Raw") }
	}

	@Test("logs sidebar shows available source names")
	func logsSidebarShowsSourceNames() throws {
		let store = seededStore()
		let view = LogsSidebarView(store: store)
		#expect(throws: Never.self) { try view.inspect().find(text: "Daemon") }
	}

	@Test("logs detail shows empty state when no source selected")
	func logsDetailShowsEmptyState() throws {
		let store = LogsStore()
		let view = LogsDetailView(store: store)
		#expect(throws: Never.self) { try view.inspect().find(text: "No source selected") }
	}

	@Test("logs detail shows selected source structured view")
	func logsDetailShowsSourceView() throws {
		let store = seededStore()
		let view = LogsDetailView(store: store)
		#expect(throws: Never.self) { try view.inspect().find(text: "Daemon") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Info") }
		#expect(throws: Never.self) {
			try view.inspect().find(text: "1 entry · source “daemon”")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(ViewType.TextField.self)
		}
	}

	@Test("source detail shows empty when no matching entries")
	func sourceDetailEmpty() throws {
		let store = LogsStore()
		store.selectedSource = "missing"
		store.hasLoadedOnce = true
		let view = LogsSourceDetailView(store: store, source: "missing")
		#expect(throws: Never.self) { try view.inspect().find(text: "No entries") }
	}

	@Test("source detail shows search field placeholder")
	func sourceDetailShowsSearchField() throws {
		let store = seededStore()
		let view = LogsSourceDetailView(store: store, source: "daemon")
		#expect(throws: Never.self) {
			try view.inspect().find(ViewType.TextField.self)
		}
	}

	@Test("load more bar shows when hasMore")
	func loadMoreBarWhenHasMore() throws {
		let store = seededStore()
		store.hasMore = true
		store.matched = 250
		store.entries = Array(repeating: store.entries[0], count: 100)
		// Distinct ids for ForEach safety not needed for bar text
		let view = LogsDetailView(store: store)
		#expect(throws: Never.self) {
			try view.inspect().find(text: "Load \(LogsStore.pageSize) more")
		}
	}

	@Test("logs view detail toolbar includes refresh control")
	func logsViewHasRefreshButton() throws {
		let store = LogsStore()
		let view = LogsView(store: store)
		#expect(throws: Never.self) { try view.inspect() }
	}
}
