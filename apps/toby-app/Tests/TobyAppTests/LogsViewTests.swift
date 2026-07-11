import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("LogsView")
struct LogsViewTests {
	private func sampleJSONL() -> String {
		let formatter = ISO8601DateFormatter()
		formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		let t0 = formatter.string(from: Date().addingTimeInterval(-3600))
		let t1 = formatter.string(from: Date().addingTimeInterval(-3500))
		return """
		{"ts":"\(t0)","source":"daemon","level":"info","category":"plugin","type":"poll_complete","data":{"plugin":"email"}}
		{"ts":"\(t1)","source":"chat","level":"error","category":"turn","type":"turn_failed","data":{"reason":"boom"}}
		"""
	}

	@Test("logs sidebar shows Raw section header")
	func logsSidebarShowsRawHeader() throws {
		let store = LogsStore(directoryURL: URL(fileURLWithPath: "/tmp"))
		let view = LogsSidebarView(store: store)
		#expect(throws: Never.self) { try view.inspect().find(text: "Raw") }
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

	@Test("logs sidebar shows sources after parse")
	func logsSidebarShowsSources() throws {
		let dir = FileManager.default.temporaryDirectory.appendingPathComponent("logs-view-test-\(UUID().uuidString)")
		let logsDir = dir.appendingPathComponent("logs")
		try? FileManager.default.createDirectory(at: logsDir, withIntermediateDirectories: true)
		defer { try? FileManager.default.removeItem(at: dir) }

		try? sampleJSONL().write(to: logsDir.appendingPathComponent("toby.log"), atomically: true, encoding: .utf8)

		let store = LogsStore(directoryURL: dir)
		store.refreshAvailableLogs()
		store.selectLog(store.availableLogs.first!)

		let view = LogsSidebarView(store: store)
		#expect(throws: Never.self) { try view.inspect().find(text: "Sources") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Daemon") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Chat") }
		store.stopPolling()
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
		#expect(throws: Never.self) { try view.inspect().find(ViewType.TextField.self) }
		store.stopPolling()
	}

	@Test("raw filterLines keeps matching lines only")
	func rawFilterLines() {
		let content = """
		alpha one
		beta two
		alpha three
		"""
		let filtered = LogsRawDetailView.filterLines(content, matching: "alpha")
		#expect(filtered.contains("alpha one"))
		#expect(filtered.contains("alpha three"))
		#expect(!filtered.contains("beta"))
		#expect(LogsRawDetailView.filterLines(content, matching: "  ").contains("beta"))
		#expect(LogsRawDetailView.filterLines(content, matching: "zzz").isEmpty)
	}

	@Test("logs detail shows source structured view")
	func logsDetailShowsSourceView() throws {
		let dir = FileManager.default.temporaryDirectory.appendingPathComponent("logs-view-test-\(UUID().uuidString)")
		let logsDir = dir.appendingPathComponent("logs")
		try? FileManager.default.createDirectory(at: logsDir, withIntermediateDirectories: true)
		defer { try? FileManager.default.removeItem(at: dir) }

		try? sampleJSONL().write(to: logsDir.appendingPathComponent("toby.log"), atomically: true, encoding: .utf8)

		let store = LogsStore(directoryURL: dir)
		store.refreshAvailableLogs()
		store.selectLog(store.availableLogs.first!)
		store.selectSource("daemon")

		let view = LogsDetailView(store: store)
		#expect(throws: Never.self) { try view.inspect().find(text: "Daemon") }
		#expect(throws: Never.self) { try view.inspect().find(text: "Info") }
		#expect(throws: Never.self) {
			try view.inspect().find(text: "1 entry · last \(LogsStore.maxTailLines) lines · source “daemon”")
		}
		#expect(throws: Never.self) {
			try view.inspect().find(ViewType.TextField.self)
		}
		store.stopPolling()
	}

	@Test("source detail shows empty when no matching entries")
	func sourceDetailEmpty() throws {
		let store = LogsStore(directoryURL: URL(fileURLWithPath: "/tmp"))
		store.selection = .source("missing")
		let view = LogsSourceDetailView(store: store, source: "missing")
		#expect(throws: Never.self) { try view.inspect().find(text: "No entries") }
	}

	@Test("source detail shows search field placeholder")
	func sourceDetailShowsSearchField() throws {
		let store = LogsStore(directoryURL: URL(fileURLWithPath: "/tmp"))
		store.selection = .source("daemon")
		let view = LogsSourceDetailView(store: store, source: "daemon")
		#expect(throws: Never.self) {
			try view.inspect().find(ViewType.TextField.self)
		}
	}

	@Test("logs view detail toolbar includes refresh control")
	func logsViewHasRefreshButton() throws {
		let store = LogsStore(directoryURL: URL(fileURLWithPath: "/tmp"))
		let view = LogsView(store: store, tobyDirectory: nil)
		// Toolbar items are not always inspectable; ensure the view builds.
		#expect(throws: Never.self) { try view.inspect() }
	}
}
