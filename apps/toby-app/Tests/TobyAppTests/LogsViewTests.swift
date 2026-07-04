import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("LogsView")
struct LogsViewTests {
	@Test("logs sidebar shows 'Logs' header")
	func logsSidebarShowsHeader() throws {
		let store = LogsStore(directoryURL: URL(fileURLWithPath: "/tmp"))
		let view = LogsSidebarView(store: store)
		#expect(throws: Never.self) { try view.inspect().find(text: "Logs") }
	}

	@Test("logs sidebar shows empty state when no logs")
	func logsSidebarShowsEmptyState() throws {
		let store = LogsStore(directoryURL: URL(fileURLWithPath: "/tmp/nonexistent-\(UUID().uuidString)"))
		let view = LogsSidebarView(store: store)
		#expect(throws: Never.self) { try view.inspect().find(text: "No logs found") }
	}

	@Test("logs sidebar shows available log names")
	func logsSidebarShowsLogNames() throws {
		let dir = FileManager.default.temporaryDirectory.appendingPathComponent("logs-view-test-\(UUID().uuidString)")
		let logsDir = dir.appendingPathComponent("logs")
		try? FileManager.default.createDirectory(at: logsDir, withIntermediateDirectories: true)
		defer { try? FileManager.default.removeItem(at: dir) }

		try? "test\n".write(to: logsDir.appendingPathComponent("toby.log"), atomically: true, encoding: .utf8)

		let store = LogsStore(directoryURL: dir)
		store.refreshAvailableLogs()
		let view = LogsSidebarView(store: store)
		#expect(throws: Never.self) { try view.inspect().find(text: "Toby") }
	}

	@Test("logs detail shows empty state when no log selected")
	func logsDetailShowsEmptyState() throws {
		let store = LogsStore(directoryURL: URL(fileURLWithPath: "/tmp"))
		let view = LogsDetailView(store: store)
		#expect(throws: Never.self) { try view.inspect().find(text: "No log selected") }
	}

	@Test("logs detail shows selected log name and path")
	func logsDetailShowsSelectedLog() throws {
		let dir = FileManager.default.temporaryDirectory.appendingPathComponent("logs-view-test-\(UUID().uuidString)")
		let logsDir = dir.appendingPathComponent("logs")
		try? FileManager.default.createDirectory(at: logsDir, withIntermediateDirectories: true)
		defer { try? FileManager.default.removeItem(at: dir) }

		let url = logsDir.appendingPathComponent("toby.log")
		try? "content\n".write(to: url, atomically: true, encoding: .utf8)

		let store = LogsStore(directoryURL: dir)
		store.refreshAvailableLogs()
		let log = store.availableLogs.first { $0.fileName == "logs/toby.log" }!
		store.selectLog(log)

		let view = LogsDetailView(store: store)
		#expect(throws: Never.self) { try view.inspect().find(text: "Toby") }
		store.stopPolling()
	}
}
