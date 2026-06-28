import Foundation

enum ServerEventLog {
	static var url: URL {
		FileManager.default.homeDirectoryForCurrentUser
			.appendingPathComponent(".toby/native-app-server-events.log")
	}

	static var path: String {
		url.path
	}

	static func append(_ message: String) {
		let line = "[\(Self.timestamp())] \(message)\n"
		guard let data = line.data(using: .utf8) else { return }
		do {
			let directory = url.deletingLastPathComponent()
			try FileManager.default.createDirectory(
				at: directory,
				withIntermediateDirectories: true,
			)
			if !FileManager.default.fileExists(atPath: url.path) {
				FileManager.default.createFile(atPath: url.path, contents: nil)
			}
			let handle = try FileHandle(forWritingTo: url)
			defer { try? handle.close() }
			try handle.seekToEnd()
			try handle.write(contentsOf: data)
		} catch {
			print("Failed to write server event log: \(error)")
		}
	}

	static func beginTurn(sessionId: String, text: String, url: URL) {
		append("----- BEGIN TURN -----")
		append("request.url=\(url.absoluteString)")
		append("session.id=\(sessionId)")
		append("prompt=\(text)")
	}

	static func endTurn() {
		append("----- END TURN -----")
	}

	private static func timestamp() -> String {
		let formatter = ISO8601DateFormatter()
		formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		return formatter.string(from: Date())
	}
}
