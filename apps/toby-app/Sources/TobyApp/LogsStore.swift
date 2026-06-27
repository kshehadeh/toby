import Foundation

@Observable
@MainActor
final class LogsStore {
	struct LogDescriptor: Identifiable, Hashable {
		let id: String
		let displayName: String
		let fileName: String
		let url: URL

		var exists: Bool { FileManager.default.fileExists(atPath: url.path) }
	}

	var availableLogs: [LogDescriptor] = []
	var selectedLog: LogDescriptor?
	var content: String = ""
	var isLoading = false

	private var pollTask: Task<Void, Never>?
	private var lastFileSize: UInt64 = 0

	private let maxTailBytes: UInt64 = 256_000
	private let directoryURL: URL

	init(directoryURL: URL? = nil) {
		self.directoryURL = directoryURL ?? Self.tobyDir
	}

	static var tobyDir: URL {
		if let override = ProcessInfo.processInfo.environment["TOBY_DIR"], !override.isEmpty {
			return URL(fileURLWithPath: (override as NSString).expandingTildeInPath)
		}
		return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".toby")
	}

	static let knownLogs: [(name: String, file: String)] = [
		("App Server Events", "native-app-server-events.log"),
		("Daemon", "daemon.log"),
		("Toby", "toby.log"),
		("TUI Server Events", "tui-server-events.log"),
		("Upgrade", "upgrade.log"),
		("macOS Plugin", "plugin-macos.log"),
	]

	func refreshAvailableLogs() {
		availableLogs = Self.knownLogs.compactMap { (name, file) in
			let url = directoryURL.appendingPathComponent(file)
			guard FileManager.default.fileExists(atPath: url.path) else { return nil }
			return LogDescriptor(id: file, displayName: name, fileName: file, url: url)
		}
	}

	func selectLog(_ log: LogDescriptor) {
		selectedLog = log
		cancelPolling()
		content = ""
		lastFileSize = 0
		loadInitialTail()
		startPolling()
	}

	func stopPolling() {
		cancelPolling()
	}

	func loadInitialTail() {
		guard let log = selectedLog else { return }
		guard let attrs = try? FileManager.default.attributesOfItem(atPath: log.url.path),
		      let fileSize = attrs[.size] as? UInt64 else { return }

		lastFileSize = fileSize

		if fileSize <= maxTailBytes {
			content = (try? String(contentsOf: log.url, encoding: .utf8)) ?? ""
		} else {
			guard let handle = try? FileHandle(forReadingFrom: log.url) else { return }
			defer { try? handle.close() }
			let offset = fileSize - maxTailBytes
			try? handle.seek(toOffset: offset)
			if let data = try? handle.readToEnd() {
				var text = String(data: data, encoding: .utf8) ?? ""
				if let nl = text.firstIndex(of: "\n") {
					text = String(text[text.index(after: nl)...])
				}
				content = text
			}
		}
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

	func checkForUpdates() {
		guard let log = selectedLog else { return }
		guard let attrs = try? FileManager.default.attributesOfItem(atPath: log.url.path),
		      let fileSize = attrs[.size] as? UInt64 else { return }

		if fileSize < lastFileSize {
			lastFileSize = fileSize
			loadInitialTail()
			return
		}

		if fileSize > lastFileSize {
			guard let handle = try? FileHandle(forReadingFrom: log.url) else { return }
			defer { try? handle.close() }
			try? handle.seek(toOffset: lastFileSize)
			if let data = try? handle.readToEnd() {
				let newText = String(data: data, encoding: .utf8) ?? ""
				content += newText
				lastFileSize = fileSize
			}
		}
	}
}
