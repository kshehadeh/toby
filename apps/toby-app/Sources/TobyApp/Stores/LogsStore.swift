import Foundation

enum LogsSelection: Hashable, Sendable {
	case raw(LogsStore.LogDescriptor)
	case source(String)
}

@Observable
@MainActor
final class LogsStore {
	struct LogDescriptor: Identifiable, Hashable, Sendable {
		let id: String
		let displayName: String
		let fileName: String
		let url: URL

		var exists: Bool { FileManager.default.fileExists(atPath: url.path) }
	}

	var availableLogs: [LogDescriptor] = []
	/// Currently selected sidebar item (raw file or parsed source).
	var selection: LogsSelection?
	var content: String = "" {
		didSet { reparseContent() }
	}
	var isLoading = false
	/// Structured entries for the Sources UI (from the tailed lines only).
	var parsedEntries: [UnifiedLogEntry] = []
	var discoveredSources: [String] = []

	/// Max lines loaded from disk (like `tail -n`). Shared by Raw and Sources.
	static let maxTailLines = 1000
	/// Secondary filter for Sources: drop entries older than this within the tailed window.
	static let sourceLookbackInterval: TimeInterval = 24 * 60 * 60

	/// Back-compat for older call sites / tests that used `selectedLog`.
	var selectedLog: LogDescriptor? {
		if case let .raw(log) = selection { return log }
		return nil
	}

	/// Absolute path of the tailed log file (for Reveal in Finder).
	var logFilePath: String? {
		if let tailedLog { return tailedLog.url.path }
		return availableLogs.first?.url.path
	}

	/// Directory containing the log file.
	var logDirectoryPath: String? {
		guard let logFilePath else { return nil }
		return URL(fileURLWithPath: logFilePath).deletingLastPathComponent().path
	}

	private var pollTask: Task<Void, Never>?
	private var lastFileSize: UInt64 = 0

	private var directoryURL: URL?
	/// URL of the file currently being tailed (raw selection or shared unified log).
	private var tailedLog: LogDescriptor?

	init(directoryURL: URL? = nil) {
		self.directoryURL = directoryURL
	}

	static let knownLogs: [(name: String, relativeComponents: [String])] = [
		("Toby", ["logs", "toby.log"]),
	]

	func refreshAvailableLogs() {
		guard let directoryURL else {
			availableLogs = []
			selection = nil
			tailedLog = nil
			content = ""
			return
		}
		availableLogs = Self.knownLogs.compactMap { (name, components) in
			let url = components.reduce(directoryURL) { $0.appendingPathComponent($1) }
			guard FileManager.default.fileExists(atPath: url.path) else { return nil }
			let fileName = components.joined(separator: "/")
			return LogDescriptor(id: fileName, displayName: name, fileName: fileName, url: url)
		}
	}

	func setDirectory(path: String?) {
		guard let path, !path.isEmpty else {
			if directoryURL != nil {
				directoryURL = nil
				selection = nil
				tailedLog = nil
				content = ""
				refreshAvailableLogs()
			}
			return
		}

		let nextURL = URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
		guard directoryURL != nextURL else { return }
		directoryURL = nextURL
		selection = nil
		tailedLog = nil
		content = ""
		refreshAvailableLogs()
	}

	func selectLog(_ log: LogDescriptor) {
		selection = .raw(log)
		beginTailing(log)
	}

	func selectSource(_ source: String) {
		selection = .source(source)
		// Keep tailing the unified log so sources stay live; prefer current tailed
		// log or the first available log file.
		if tailedLog != nil {
			// Already tailing — just update selection; content/poll continue.
			if pollTask == nil {
				startPolling()
			}
			return
		}
		if let log = availableLogs.first {
			beginTailing(log)
		}
	}

	func stopPolling() {
		cancelPolling()
	}

	/// Re-scan available logs and re-read the last `maxTailLines` from disk.
	func refreshFromDisk() {
		refreshAvailableLogs()
		if tailedLog == nil {
			if let log = availableLogs.first {
				beginTailing(log)
			}
			return
		}
		// Prefer the same file if it still exists; otherwise switch to first available.
		if let current = tailedLog, current.exists {
			loadInitialTail()
		} else if let log = availableLogs.first {
			beginTailing(log)
		} else {
			tailedLog = nil
			content = ""
			lastFileSize = 0
		}
	}

	func loadInitialTail() {
		guard let log = tailedLog else { return }
		guard let attrs = try? FileManager.default.attributesOfItem(atPath: log.url.path),
		      let fileSize = attrs[.size] as? UInt64 else { return }

		lastFileSize = fileSize
		// Assign even when text is unchanged so reparse still runs if only mtime changed
		// with identical content — use a force path when content is equal.
		let next = Self.readLastLines(from: log.url, maxLines: Self.maxTailLines)
		if next == content {
			// didSet won't fire; reparse explicitly so Sources stay in sync.
			reparseContent()
		} else {
			content = next
		}
	}

	func entries(forSource source: String, matching search: String = "") -> [UnifiedLogEntry] {
		let base = parsedEntries.filter { $0.source == source }
		let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !query.isEmpty else { return base }
		return base.filter { $0.matches(search: query) }
	}

	/// Entries for a source grouped by level (severity order). Empty levels omitted.
	/// Within each level, newest first. Optional `search` filters entries before grouping.
	func entriesByLevel(
		forSource source: String,
		matching search: String = ""
	) -> [(level: String, entries: [UnifiedLogEntry])] {
		let filtered = entries(forSource: source, matching: search)
		var buckets: [String: [UnifiedLogEntry]] = [:]
		for entry in filtered {
			buckets[entry.level, default: []].append(entry)
		}
		return UnifiedLogEntry.levelOrder.compactMap { level in
			guard var list = buckets[level], !list.isEmpty else { return nil }
			list.sort { lhs, rhs in
				// Newest first by parsed date when available, else by ts string.
				let ld = lhs.parsedDate
				let rd = rhs.parsedDate
				if let ld, let rd { return ld > rd }
				return lhs.ts > rhs.ts
			}
			return (level: level, entries: list)
		}
	}

	func checkForUpdates() {
		guard let log = tailedLog else { return }
		guard let attrs = try? FileManager.default.attributesOfItem(atPath: log.url.path),
		      let fileSize = attrs[.size] as? UInt64 else { return }

		// Any size change (append or rotation): re-tail last N lines so content never grows.
		if fileSize != lastFileSize {
			loadInitialTail()
		}
	}

	/// Read the last `maxLines` newline-delimited lines from `url` (like `tail -n`).
	/// Scans backward from EOF so large files do not need a full in-memory load.
	static func readLastLines(from url: URL, maxLines: Int) -> String {
		guard maxLines > 0 else { return "" }
		guard let handle = try? FileHandle(forReadingFrom: url) else { return "" }
		defer { try? handle.close() }

		let fileSize: UInt64
		do {
			fileSize = try handle.seekToEnd()
		} catch {
			return ""
		}
		if fileSize == 0 { return "" }

		let chunkSize: UInt64 = 8_192
		var collected = Data()
		var pos = fileSize
		var newlineCount = 0

		while pos > 0 && newlineCount <= maxLines {
			let size = min(chunkSize, pos)
			pos -= size
			do {
				try handle.seek(toOffset: pos)
			} catch {
				break
			}
			guard let chunk = try? handle.read(upToCount: Int(size)), !chunk.isEmpty else { break }
			collected.insert(contentsOf: chunk, at: 0)
			newlineCount = collected.reduce(into: 0) { count, byte in
				if byte == 0x0A { count += 1 }
			}
		}

		guard var text = String(data: collected, encoding: .utf8) else {
			return ""
		}

		// If we did not start at byte 0, the first line may be partial — drop it.
		if pos > 0, let idx = text.firstIndex(of: "\n") {
			text = String(text[text.index(after: idx)...])
		}

		var lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
		if lines.last == "" {
			lines.removeLast()
		}
		if lines.count > maxLines {
			lines = Array(lines.suffix(maxLines))
		}
		guard !lines.isEmpty else { return "" }
		return lines.joined(separator: "\n") + "\n"
	}

	// MARK: - Private

	private func beginTailing(_ log: LogDescriptor) {
		cancelPolling()
		tailedLog = log
		content = ""
		lastFileSize = 0
		loadInitialTail()
		startPolling()
	}

	private func reparseContent() {
		// Parse only the tailed window; also drop entries older than the lookback.
		let since = Date().addingTimeInterval(-Self.sourceLookbackInterval)
		let entries = UnifiedLogEntry.parseJSONL(content, since: since)
		parsedEntries = entries
		let sources = Set(entries.map(\.source))
		discoveredSources = UnifiedLogEntry.sortSources(Array(sources))
	}

	private func startPolling() {
		pollTask = Task { [weak self] in
			while !Task.isCancelled {
				try? await Task.sleep(nanoseconds: 1_000_000_000)
				guard let self else { return }
				self.checkForUpdates()
			}
		}
	}

	private func cancelPolling() {
		pollTask?.cancel()
		pollTask = nil
	}
}
