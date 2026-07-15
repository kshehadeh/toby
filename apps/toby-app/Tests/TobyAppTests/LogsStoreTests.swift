import Testing
import Foundation
@testable import TobyApp

@MainActor
private final class FakeLogsClient: LogsFetching {
	var lastSource: String?
	var lastLevel: String?
	var lastCategory: String?
	var lastType: String?
	var lastQuery: String?
	var lastLimit: Int?
	var response: LogsListResponse
	var callCount = 0
	var error: Error?

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
		callCount += 1
		lastSource = source
		lastLevel = level
		lastCategory = category
		lastType = type
		lastQuery = query
		lastLimit = limit
		if let error { throw error }
		return response
	}
}

@MainActor
@Suite("LogsStore")
struct LogsStoreTests {
	private func sampleEntry(
		source: String = "daemon",
		level: String = "info",
		category: String = "plugin",
		type: String = "poll_complete",
		index: Int = 0
	) -> UnifiedLogEntry {
		UnifiedLogEntry(
			id: "\(index)|\(source)|\(type)",
			ts: ISO8601DateFormatter().string(from: Date().addingTimeInterval(TimeInterval(-index))),
			source: source,
			level: level,
			category: category,
			type: type,
			sessionId: nil,
			turnIndex: nil,
			message: "hello",
			dataPretty: "{\n  \"plugin\" : \"email\"\n}"
		)
	}

	private func sampleResponse(
		entries: [UnifiedLogEntry]? = nil,
		sources: [LogFacetBucket]? = nil,
		matched: Int? = nil,
		hasMore: Bool = false,
		limit: Int = 100
	) -> LogsListResponse {
		let entries = entries ?? [sampleEntry()]
		return LogsListResponse(
			logPath: "/tmp/toby.log",
			entries: entries,
			limit: limit,
			matched: matched ?? entries.count,
			hasMore: hasMore,
			facets: LogFacets(
				sources: sources ?? [
					LogFacetBucket(name: "daemon", count: 2),
					LogFacetBucket(name: "chat", count: 1),
				],
				levels: [LogFacetBucket(name: "info", count: 2), LogFacetBucket(name: "error", count: 1)],
				categories: [LogFacetBucket(name: "plugin", count: 2)],
				types: [LogFacetBucket(name: "poll_complete", count: 1)]
			)
		)
	}

	@Test("refresh loads entries and facets from client")
	func refreshLoadsFromClient() async throws {
		let client = FakeLogsClient(response: sampleResponse())
		let store = LogsStore(client: client)
		await store.refresh()

		#expect(client.callCount == 1)
		#expect(store.entries.count == 1)
		#expect(store.logPath == "/tmp/toby.log")
		#expect(store.discoveredSources == ["daemon", "chat"])
		#expect(store.hasLoadedOnce)
		store.stopPolling()
	}

	@Test("selectSource sends source filter and resets limit")
	func selectSourceFilters() async throws {
		let client = FakeLogsClient(response: sampleResponse())
		let store = LogsStore(client: client)
		store.loadedLimit = 300
		store.selectSource("daemon")
		// selectSource kicks off an async refresh
		try await Task.sleep(nanoseconds: 50_000_000)
		#expect(client.lastSource == "daemon")
		#expect(client.lastLimit == LogsStore.pageSize)
		#expect(store.selectedSource == "daemon")
		store.stopPolling()
	}

	@Test("loadMoreLines increases limit")
	func loadMoreIncreasesLimit() async throws {
		let client = FakeLogsClient(response: sampleResponse(matched: 250, hasMore: true))
		let store = LogsStore(client: client)
		await store.refresh()
		#expect(store.canLoadMore)
		store.loadMoreLines()
		try await Task.sleep(nanoseconds: 50_000_000)
		#expect(client.lastLimit == LogsStore.pageSize * 2)
		store.stopPolling()
	}

	@Test("setFilterLevel sends level query param")
	func setFilterLevelSendsParam() async throws {
		let client = FakeLogsClient(response: sampleResponse())
		let store = LogsStore(client: client)
		store.selectedSource = "daemon"
		store.setFilterLevel("error")
		try await Task.sleep(nanoseconds: 50_000_000)
		#expect(client.lastLevel == "error")
		#expect(client.lastSource == "daemon")
		store.stopPolling()
	}

	@Test("setSearchQuery sends q param")
	func setSearchQuerySendsQ() async throws {
		let client = FakeLogsClient(response: sampleResponse())
		let store = LogsStore(client: client)
		store.setSearchQuery("timeout")
		try await Task.sleep(nanoseconds: 50_000_000)
		#expect(client.lastQuery == "timeout")
		store.stopPolling()
	}

	@Test("entriesByLevel groups by severity")
	func entriesByLevelGroups() async throws {
		let entries = [
			sampleEntry(level: "info", type: "a", index: 0),
			sampleEntry(level: "error", type: "b", index: 1),
			sampleEntry(level: "info", type: "c", index: 2),
		]
		let client = FakeLogsClient(response: sampleResponse(entries: entries))
		let store = LogsStore(client: client)
		await store.refresh()
		let groups = store.entriesByLevel()
		#expect(groups.map(\.level) == ["error", "info"])
		#expect(groups[0].entries.count == 1)
		#expect(groups[1].entries.count == 2)
		store.stopPolling()
	}

	@Test("ensureLoaded auto-selects first source")
	func ensureLoadedSelectsFirstSource() async throws {
		let client = FakeLogsClient(response: sampleResponse())
		let store = LogsStore(client: client)
		await store.ensureLoaded()
		#expect(store.selectedSource == "daemon")
		#expect(client.lastSource == "daemon")
		store.stopPolling()
	}

	@Test("UnifiedLogEntry display names")
	func displayNames() {
		#expect(UnifiedLogEntry.displayName(forSource: "native-app") == "Native App")
		#expect(UnifiedLogEntry.displayName(forLevel: "warn") == "Warning")
		#expect(UnifiedLogEntry.sortSources(["native-app", "zzz", "chat"]) == ["chat", "native-app", "zzz"])
	}

	@Test("fromAPIObject extracts message from data")
	func fromAPIObjectExtractsMessage() {
		let obj: [String: Any] = [
			"ts": "2026-01-01T00:00:00.000Z",
			"source": "native-app",
			"level": "info",
			"category": "server",
			"type": "log",
			"data": ["message": "hello world", "code": 42],
		]
		let entry = UnifiedLogEntry.fromAPIObject(obj, index: 0)
		#expect(entry?.message == "hello world")
		#expect(entry?.dataPretty?.contains("message") != true)
		#expect(entry?.dataPretty?.contains("code") == true)
	}

	@Test("LogsListParser parses API payload")
	func listParserParses() throws {
		let json = """
		{
		  "logPath": "/tmp/x.log",
		  "limit": 100,
		  "matched": 1,
		  "hasMore": false,
		  "entries": [
		    {
		      "ts": "2026-01-01T00:00:00.000Z",
		      "source": "daemon",
		      "level": "info",
		      "category": "plugin",
		      "type": "poll_complete",
		      "data": { "plugin": "email" }
		    }
		  ],
		  "facets": {
		    "sources": [{ "name": "daemon", "count": 1 }],
		    "levels": [{ "name": "info", "count": 1 }],
		    "categories": [{ "name": "plugin", "count": 1 }],
		    "types": [{ "name": "poll_complete", "count": 1 }]
		  }
		}
		"""
		let response = try LogsListParser.parse(Data(json.utf8))
		#expect(response.logPath == "/tmp/x.log")
		#expect(response.entries.count == 1)
		#expect(response.facets.sources.first?.name == "daemon")
	}
}
