import Foundation
import SwiftUI

/// One structured line from the unified log (`~/.toby/logs/toby.log`).
/// Mirrors `UnifiedLogEntry` in `packages/core/src/logging/logger.ts`.
struct UnifiedLogEntry: Identifiable, Hashable, Sendable {
	let id: String
	let ts: String
	let source: String
	let level: String
	let category: String
	let type: String
	let sessionId: String?
	let turnIndex: Int?
	/// Pulled from `data.message` when present (shown as its own line in the UI).
	let message: String?
	/// Pretty-printed JSON for `data` with `message` removed, or nil when empty/absent.
	let dataPretty: String?

	static let knownSources: [String] = [
		"chat",
		"daemon",
		"server",
		"upgrade",
		"native-app",
		"macos-plugin",
	]

	static let levelOrder: [String] = ["error", "warn", "info", "debug"]

	var parsedDate: Date? {
		DashboardDate.parse(ts)
	}

	var formattedTime: String {
		guard let date = parsedDate else { return ts }
		return date.formatted(date: .omitted, time: .standard)
	}

	var levelDisplayName: String {
		Self.displayName(forLevel: level)
	}

	var sourceDisplayName: String {
		Self.displayName(forSource: source)
	}

	/// Case-insensitive match against the fields shown in the source list UI.
	func matches(search query: String) -> Bool {
		let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { return true }
		let q = trimmed.lowercased()
		if level.lowercased().contains(q) { return true }
		if levelDisplayName.lowercased().contains(q) { return true }
		if category.lowercased().contains(q) { return true }
		if type.lowercased().contains(q) { return true }
		if message?.lowercased().contains(q) == true { return true }
		if dataPretty?.lowercased().contains(q) == true { return true }
		if sessionId?.lowercased().contains(q) == true { return true }
		if formattedTime.lowercased().contains(q) { return true }
		if ts.lowercased().contains(q) { return true }
		return false
	}

	static func displayName(forSource source: String) -> String {
		switch source {
		case "chat": return "Chat"
		case "daemon": return "Daemon"
		case "server": return "Server"
		case "upgrade": return "Upgrade"
		case "native-app": return "Native App"
		case "macos-plugin": return "macOS Plugin"
		default:
			return source
				.split(separator: "-")
				.map { $0.prefix(1).uppercased() + $0.dropFirst() }
				.joined(separator: " ")
		}
	}

	static func displayName(forLevel level: String) -> String {
		switch level.lowercased() {
		case "error": return "Error"
		case "warn", "warning": return "Warning"
		case "info": return "Info"
		case "debug": return "Debug"
		default: return level.prefix(1).uppercased() + level.dropFirst()
		}
	}

	static func systemImage(forSource source: String) -> String {
		switch source {
		case "chat": return "bubble.left.and.bubble.right.fill"
		case "daemon": return "gearshape.2.fill"
		case "server": return "network"
		case "upgrade": return "arrow.up.circle.fill"
		case "native-app": return "macwindow"
		case "macos-plugin": return "puzzlepiece.extension.fill"
		default: return "tray.full.fill"
		}
	}

	static func tint(forLevel level: String) -> Color {
		switch level.lowercased() {
		case "error": return Color(red: 0.95, green: 0.35, blue: 0.35)
		case "warn", "warning": return Color(red: 0.95, green: 0.65, blue: 0.25)
		case "info": return Color(red: 0.40, green: 0.70, blue: 0.95)
		case "debug": return Color.white.opacity(0.45)
		default: return AppTheme.secondaryText
		}
	}

	/// Sort known sources first (schema order), then unknown alphabetically.
	static func sortSources(_ sources: [String]) -> [String] {
		let knownSet = Set(knownSources)
		let known = knownSources.filter { sources.contains($0) }
		let unknown = sources.filter { !knownSet.contains($0) }.sorted()
		return known + unknown
	}

	/// Parse JSONL content into entries. Malformed lines are skipped.
	/// When `since` is set, entries older than that date (and lines with unparseable `ts`)
	/// are skipped *before* pretty-printing `data`, which keeps source views cheap.
	static func parseJSONL(_ content: String, since: Date? = nil) -> [UnifiedLogEntry] {
		var entries: [UnifiedLogEntry] = []
		entries.reserveCapacity(256)

		var lineIndex = 0
		content.enumerateLines { line, _ in
			defer { lineIndex += 1 }
			let trimmed = line.trimmingCharacters(in: .whitespaces)
			guard !trimmed.isEmpty else { return }
			guard let data = trimmed.data(using: .utf8) else { return }
			guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
				return
			}
			guard let ts = obj["ts"] as? String,
			      let source = obj["source"] as? String,
			      let level = obj["level"] as? String,
			      let category = obj["category"] as? String,
			      let type = obj["type"] as? String
			else { return }

			if let since {
				guard let date = DashboardDate.parse(ts), date >= since else { return }
			}

			let sessionId = obj["sessionId"] as? String
			let turnIndex = obj["turnIndex"] as? Int

			// Always surface data.message as its own field; strip it from the JSON body.
			let message: String?
			let dataPretty: String?
			if var dataDict = obj["data"] as? [String: Any] {
				if let msg = dataDict.removeValue(forKey: "message") {
					if let s = msg as? String {
						message = s
					} else if msg is NSNull {
						message = nil
					} else {
						message = String(describing: msg)
					}
				} else {
					message = nil
				}
				if dataDict.isEmpty {
					dataPretty = nil
				} else if JSONSerialization.isValidJSONObject(dataDict),
				          let prettyData = try? JSONSerialization.data(
				          	withJSONObject: dataDict,
				          	options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
				          ),
				          let pretty = String(data: prettyData, encoding: .utf8)
				{
					dataPretty = pretty
				} else {
					dataPretty = String(describing: dataDict)
				}
			} else if let dataValue = obj["data"],
			          JSONSerialization.isValidJSONObject(dataValue),
			          let prettyData = try? JSONSerialization.data(
			          	withJSONObject: dataValue,
			          	options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
			          ),
			          let pretty = String(data: prettyData, encoding: .utf8)
			{
				// Non-object data (array, etc.) — no message to extract.
				message = nil
				dataPretty = pretty
			} else if let dataValue = obj["data"] {
				message = nil
				dataPretty = String(describing: dataValue)
			} else {
				message = nil
				dataPretty = nil
			}

			// Stable-ish id: line index + ts + type (content may grow with poll)
			let id = "\(lineIndex)|\(ts)|\(source)|\(type)|\(category)"
			entries.append(
				UnifiedLogEntry(
					id: id,
					ts: ts,
					source: source,
					level: level.lowercased(),
					category: category,
					type: type,
					sessionId: sessionId,
					turnIndex: turnIndex,
					message: message,
					dataPretty: dataPretty
				)
			)
		}
		return entries
	}
}
