import Foundation

/// Unified JSON-lines log writer for the native macOS app.
///
/// Appends structured entries with `source: "native-app"` to the shared
/// log file at `$TOBY_DIR/logs/toby.log` (default `~/.toby/logs/toby.log`).
/// Mirrors the TypeScript unified logger schema (`packages/core/src/logging/logger.ts`).
enum ServerEventLog {
	static var url: URL {
		URL(fileURLWithPath: ConfigReader.resolveTobyDir())
			.appendingPathComponent("logs/toby.log")
	}

	static var path: String {
		url.path
	}

	/// Append a free-form message as a structured `log` entry.
	static func append(_ message: String) {
		write(type: "log", level: "info", sessionId: nil, data: ["message": message])
	}

	static func beginTurn(sessionId: String, text: String, url: URL) {
		write(
			type: "begin_turn",
			level: "info",
			sessionId: sessionId,
			data: [
				"url": url.absoluteString,
				"prompt": text,
			]
		)
	}

	static func endTurn() {
		write(type: "end_turn", level: "info", sessionId: nil, data: nil)
	}

	/// Write a single JSON-lines entry to the unified log file.
	private static func write(
		type: String,
		level: String,
		sessionId: String?,
		data: [String: Any]?
	) {
		var entry: [String: Any] = [
			"ts": timestamp(),
			"source": "native-app",
			"level": level,
			"category": "server",
			"type": type,
		]
		if let sessionId {
			entry["sessionId"] = sessionId
		}
		if let data {
			entry["data"] = data
		}

		guard let jsonData = try? JSONSerialization.data(
			withJSONObject: entry,
			options: [.sortedKeys, .withoutEscapingSlashes]
		),
		var line = String(data: jsonData, encoding: .utf8)
		else { return }

		line += "\n"

		do {
			let directory = url.deletingLastPathComponent()
			try FileManager.default.createDirectory(
				at: directory,
				withIntermediateDirectories: true
			)
			if !FileManager.default.fileExists(atPath: url.path) {
				FileManager.default.createFile(atPath: url.path, contents: nil)
			}
			let handle = try FileHandle(forWritingTo: url)
			defer { try? handle.close() }
			try handle.seekToEnd()
			try handle.write(contentsOf: line.data(using: .utf8) ?? Data())
		} catch {
			print("Failed to write unified log: \(error)")
		}
	}

	private static func timestamp() -> String {
		let formatter = ISO8601DateFormatter()
		formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		return formatter.string(from: Date())
	}
}
