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
	private var directoryURL: URL?

	init(directoryURL: URL? = nil) {
		self.directoryURL = directoryURL
	}

	static let knownLogs: [(name: String, relativeComponents: [String])] = [
		("Toby", ["logs", "toby.log"]),
	]

	func refreshAvailableLogs() {
		guard let directoryURL else {
			availableLogs = []
			selectedLog = nil
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
				selectedLog = nil
				content = ""
				refreshAvailableLogs()
			}
			return
		}

		let nextURL = URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
		guard directoryURL != nextURL else { return }
		directoryURL = nextURL
		selectedLog = nil
		content = ""
		refreshAvailableLogs()
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
