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

	@Test("refreshAvailableLogs waits for a configured directory")
	func refreshAvailableLogsWaitsForDirectory() throws {
		let store = LogsStore()
		store.refreshAvailableLogs()
		#expect(store.availableLogs.isEmpty)
		#expect(store.selectedLog == nil)
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
		store.stopPolling()
	}

	@Test("checkForUpdates appends new content")
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
}
