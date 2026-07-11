import Testing
import Foundation
@testable import TobyApp

@MainActor
@Suite("LogsStore")
struct LogsStoreTests {
	private func makeTempDir() -> URL {
		let dir = FileManager.default.temporaryDirectory.appendingPathComponent("logs-test-\(UUID().uuidString)")
		try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
		return dir
	}

	/// Write content into `<dir>/logs/toby.log` (the unified log layout).
	@discardableResult
	private func writeUnifiedLog(_ content: String, in dir: URL) -> URL {
		let logsDir = dir.appendingPathComponent("logs")
		try? FileManager.default.createDirectory(at: logsDir, withIntermediateDirectories: true)
		let url = logsDir.appendingPathComponent("toby.log")
		try? content.write(to: url, atomically: true, encoding: .utf8)
		return url
	}

	/// ISO-8601 with fractional seconds, relative to now so the 24h source filter keeps them.
	private func iso(_ date: Date) -> String {
		let formatter = ISO8601DateFormatter()
		formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		return formatter.string(from: date)
	}

	private func makeSampleJSONL(
		recentOffset: TimeInterval = -3600,
		oldOffset: TimeInterval = -30 * 60 * 60
	) -> String {
		let t0 = iso(Date().addingTimeInterval(recentOffset))
		let t1 = iso(Date().addingTimeInterval(recentOffset + 60))
		let t2 = iso(Date().addingTimeInterval(recentOffset + 120))
		let t3 = iso(Date().addingTimeInterval(recentOffset + 180))
		let t4 = iso(Date().addingTimeInterval(recentOffset + 240))
		let old = iso(Date().addingTimeInterval(oldOffset))
		return """
		{"ts":"\(t0)","source":"daemon","level":"info","category":"plugin","type":"poll_complete","data":{"plugin":"email","newCount":0}}
		{"ts":"\(t1)","source":"daemon","level":"error","category":"plugin","type":"tool_failed","data":{"error":"timeout"}}
		{"ts":"\(t2)","source":"chat","level":"debug","category":"turn","type":"turn_start","sessionId":"abc"}
		{"ts":"\(t3)","source":"native-app","level":"warn","category":"server","type":"log","data":{"message":"hello"}}
		not-json-line
		{"ts":"\(t4)","source":"chat","level":"info","category":"model","type":"response"}
		{"ts":"\(old)","source":"daemon","level":"info","category":"plugin","type":"old_entry","data":{"plugin":"email"}}
		"""
	}

	@Test("refreshAvailableLogs waits for a configured directory")
	func refreshAvailableLogsWaitsForDirectory() throws {
		let store = LogsStore()
		store.refreshAvailableLogs()
		#expect(store.availableLogs.isEmpty)
		#expect(store.selectedLog == nil)
		#expect(store.selection == nil)
	}

	@Test("refreshAvailableLogs lists the unified log when present")
	func refreshAvailableLogsListsExisting() throws {
		let dir = makeTempDir()
		writeUnifiedLog("line1\n", in: dir)

		let store = LogsStore(directoryURL: dir)
		store.refreshAvailableLogs()

		#expect(store.availableLogs.count == 1)
		#expect(store.availableLogs.contains { $0.fileName == "logs/toby.log" })
	}

	@Test("refreshAvailableLogs shows empty when no logs exist")
	func refreshAvailableLogsEmpty() throws {
		let dir = makeTempDir()
		let store = LogsStore(directoryURL: dir)
		store.refreshAvailableLogs()
		#expect(store.availableLogs.isEmpty)
	}

	@Test("selectLog loads initial content")
	func selectLogLoadsContent() throws {
		let dir = makeTempDir()
		writeUnifiedLog("line1\nline2\nline3\n", in: dir)

		let store = LogsStore(directoryURL: dir)
		store.refreshAvailableLogs()
		let log = store.availableLogs.first { $0.fileName == "logs/toby.log" }!
		store.selectLog(log)

		#expect(store.content.contains("line1"))
		#expect(store.content.contains("line3"))
		#expect(store.selection == .raw(log))
		store.stopPolling()
	}

	@Test("logFilePath and logDirectoryPath resolve from available logs")
	func logPathsResolve() throws {
		let dir = makeTempDir()
		writeUnifiedLog("x\n", in: dir)

		let store = LogsStore(directoryURL: dir)
		store.refreshAvailableLogs()
		// Available before tailing (falls back to availableLogs)
		#expect(store.logFilePath?.hasSuffix("logs/toby.log") == true)
		#expect(store.logDirectoryPath?.hasSuffix("logs") == true)
		store.selectLog(store.availableLogs.first!)
		#expect(store.logFilePath?.hasSuffix("logs/toby.log") == true)
		store.stopPolling()
	}

	@Test("refreshFromDisk reloads content from file")
	func refreshFromDiskReloads() throws {
		let dir = makeTempDir()
		let url = writeUnifiedLog("first\n", in: dir)

		let store = LogsStore(directoryURL: dir)
		store.refreshAvailableLogs()
		store.selectLog(store.availableLogs.first!)
		#expect(store.content == "first\n")

		try "second\n".write(to: url, atomically: true, encoding: .utf8)
		// File size may change; force full re-read via refresh button path
		store.refreshFromDisk()
		#expect(store.content == "second\n")
		store.stopPolling()
	}

	@Test("checkForUpdates reloads tail after append")
	func checkForUpdatesAppends() throws {
		let dir = makeTempDir()
		let url = writeUnifiedLog("initial\n", in: dir)

		let store = LogsStore(directoryURL: dir)
		store.refreshAvailableLogs()
		let log = store.availableLogs.first { $0.fileName == "logs/toby.log" }!
		store.selectLog(log)
		#expect(store.content == "initial\n")

		// Append new data
		let handle = try FileHandle(forWritingTo: url)
		try handle.seekToEnd()
		try handle.write(contentsOf: "appended\n".data(using: .utf8)!)
		try handle.close()

		store.checkForUpdates()
		#expect(store.content == "initial\nappended\n")
		store.stopPolling()
	}

	@Test("loadInitialTail keeps only the last maxTailLines")
	func loadInitialTailCapsLines() throws {
		let dir = makeTempDir()
		let total = LogsStore.maxTailLines + 50
		var lines: [String] = []
		for i in 1...total {
			lines.append("line-\(i)")
		}
		writeUnifiedLog(lines.joined(separator: "\n") + "\n", in: dir)

		let store = LogsStore(directoryURL: dir)
		store.refreshAvailableLogs()
		store.selectLog(store.availableLogs.first!)

		let loaded = store.content.split(separator: "\n", omittingEmptySubsequences: false)
			.filter { !$0.isEmpty }
		let firstKept = total - LogsStore.maxTailLines + 1
		#expect(loaded.count == LogsStore.maxTailLines)
		#expect(loaded.first.map(String.init) == "line-\(firstKept)")
		#expect(loaded.last.map(String.init) == "line-\(total)")
		#expect(!store.content.contains("line-\(firstKept - 1)\n"))
		store.stopPolling()
	}

	@Test("readLastLines returns last N lines without loading middle")
	func readLastLinesHelper() throws {
		let dir = makeTempDir()
		let url = writeUnifiedLog((1...20).map { "L\($0)" }.joined(separator: "\n") + "\n", in: dir)
		let text = LogsStore.readLastLines(from: url, maxLines: 5)
		#expect(text == "L16\nL17\nL18\nL19\nL20\n")
	}

	@Test("checkForUpdates handles truncation/rotation")
	func checkForUpdatesHandlesTruncation() throws {
		let dir = makeTempDir()
		let url = writeUnifiedLog("old content line1\nold content line2\n", in: dir)

		let store = LogsStore(directoryURL: dir)
		store.refreshAvailableLogs()
		let log = store.availableLogs.first { $0.fileName == "logs/toby.log" }!
		store.selectLog(log)
		#expect(store.content.contains("old content"))

		// Truncate and write new content
		try "new after rotation\n".write(to: url, atomically: true, encoding: .utf8)

		store.checkForUpdates()
		#expect(store.content == "new after rotation\n")
		store.stopPolling()
	}

	@Test("selectLog sets selectedLog")
	func selectLogSetsSelected() throws {
		let dir = makeTempDir()
		writeUnifiedLog("test\n", in: dir)

		let store = LogsStore(directoryURL: dir)
		store.refreshAvailableLogs()
		let log = store.availableLogs.first!
		store.selectLog(log)
		#expect(store.selectedLog == log)
		store.stopPolling()
	}

	@Test("parsing discovers sources and skips bad lines")
	func parsingDiscoversSources() throws {
		let dir = makeTempDir()
		writeUnifiedLog(makeSampleJSONL(), in: dir)

		let store = LogsStore(directoryURL: dir)
		store.refreshAvailableLogs()
		store.selectLog(store.availableLogs.first!)

		// 5 recent structured lines; the >24h old_entry is excluded
		#expect(store.parsedEntries.count == 5)
		#expect(store.discoveredSources == ["chat", "daemon", "native-app"])
		#expect(store.entries(forSource: "daemon").count == 2)
		#expect(store.entries(forSource: "chat").count == 2)
		#expect(store.entries(forSource: "native-app").count == 1)
		#expect(!store.parsedEntries.contains { $0.type == "old_entry" })
		store.stopPolling()
	}

	@Test("entriesByLevel groups by severity order newest first")
	func entriesByLevelGroups() throws {
		let dir = makeTempDir()
		writeUnifiedLog(makeSampleJSONL(), in: dir)

		let store = LogsStore(directoryURL: dir)
		store.refreshAvailableLogs()
		store.selectLog(store.availableLogs.first!)

		let groups = store.entriesByLevel(forSource: "daemon")
		#expect(groups.map(\.level) == ["error", "info"])
		#expect(groups[0].entries.first?.type == "tool_failed")
		#expect(groups[1].entries.first?.type == "poll_complete")
		store.stopPolling()
	}

	@Test("selectSource switches selection and keeps tailing")
	func selectSourceKeepsTailing() throws {
		let dir = makeTempDir()
		writeUnifiedLog(makeSampleJSONL(), in: dir)

		let store = LogsStore(directoryURL: dir)
		store.refreshAvailableLogs()
		store.selectLog(store.availableLogs.first!)
		store.selectSource("daemon")

		#expect(store.selection == .source("daemon"))
		#expect(store.selectedLog == nil)
		#expect(!store.content.isEmpty)
		store.stopPolling()
	}

	@Test("source lookback drops entries older than 24 hours")
	func sourceLookbackFiltersOldEntries() throws {
		let dir = makeTempDir()
		// Only old entries
		writeUnifiedLog(makeSampleJSONL(recentOffset: -30 * 60 * 60, oldOffset: -48 * 60 * 60), in: dir)

		let store = LogsStore(directoryURL: dir)
		store.refreshAvailableLogs()
		store.selectLog(store.availableLogs.first!)

		#expect(store.parsedEntries.isEmpty)
		#expect(store.discoveredSources.isEmpty)
		// Raw content still includes the tailed lines (including old ones before source filter)
		#expect(store.content.contains("old_entry") || store.content.contains("daemon"))
		store.stopPolling()
	}

	@Test("UnifiedLogEntry.parseJSONL skips incomplete objects")
	func parseJSONLSkipsIncomplete() {
		let content = """
		{"ts":"x","source":"daemon","level":"info","category":"c","type":"t"}
		{"ts":"x","source":"daemon"}
		"""
		// Without since: keep the complete-but-unparseable-ts line
		let entries = UnifiedLogEntry.parseJSONL(content)
		#expect(entries.count == 1)
		#expect(entries[0].source == "daemon")

		// With since: unparseable ts is dropped
		let filtered = UnifiedLogEntry.parseJSONL(content, since: Date().addingTimeInterval(-3600))
		#expect(filtered.isEmpty)
	}

	@Test("source and level display names")
	func displayNames() {
		#expect(UnifiedLogEntry.displayName(forSource: "native-app") == "Native App")
		#expect(UnifiedLogEntry.displayName(forLevel: "warn") == "Warning")
		#expect(UnifiedLogEntry.sortSources(["native-app", "zzz", "chat"]) == ["chat", "native-app", "zzz"])
	}

	@Test("parseJSONL extracts data.message and strips it from dataPretty")
	func parseExtractsMessage() {
		let ts = iso(Date().addingTimeInterval(-60))
		let content = """
		{"ts":"\(ts)","source":"native-app","level":"info","category":"server","type":"log","data":{"message":"hello world","code":42}}
		{"ts":"\(ts)","source":"daemon","level":"info","category":"plugin","type":"x","data":{"plugin":"email"}}
		"""
		let entries = UnifiedLogEntry.parseJSONL(content, since: Date().addingTimeInterval(-3600))
		#expect(entries.count == 2)

		#expect(entries[0].message == "hello world")
		#expect(entries[0].dataPretty?.contains("message") != true)
		#expect(entries[0].dataPretty?.contains("code") == true)

		#expect(entries[1].message == nil)
		#expect(entries[1].dataPretty?.contains("plugin") == true)
	}

	@Test("parseJSONL drops dataPretty when message was the only field")
	func parseMessageOnlyData() {
		let ts = iso(Date().addingTimeInterval(-60))
		let content = """
		{"ts":"\(ts)","source":"native-app","level":"info","category":"server","type":"log","data":{"message":"only msg"}}
		"""
		let entries = UnifiedLogEntry.parseJSONL(content, since: Date().addingTimeInterval(-3600))
		#expect(entries.count == 1)
		#expect(entries[0].message == "only msg")
		#expect(entries[0].dataPretty == nil)
	}

	@Test("entries matching search filters by message category type and data")
	func entriesMatchingSearch() throws {
		let dir = makeTempDir()
		writeUnifiedLog(makeSampleJSONL(), in: dir)

		let store = LogsStore(directoryURL: dir)
		store.refreshAvailableLogs()
		store.selectLog(store.availableLogs.first!)

		#expect(store.entries(forSource: "daemon", matching: "tool_failed").count == 1)
		#expect(store.entries(forSource: "daemon", matching: "plugin").count == 2)
		#expect(store.entries(forSource: "daemon", matching: "timeout").count == 1)
		#expect(store.entries(forSource: "daemon", matching: "ERROR").count == 1)
		#expect(store.entries(forSource: "daemon", matching: "nope-xyz").isEmpty)
		#expect(store.entriesByLevel(forSource: "daemon", matching: "tool_failed").map(\.level) == ["error"])
		store.stopPolling()
	}
}
