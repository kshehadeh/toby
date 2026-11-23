import Foundation
import TobyAI

/// The unified JSONL log at `<tobyDir>/logs/toby.log` (port of
/// `logging/logger.ts` + `query.ts`). Same entry shape as the daemon, so old
/// entries stay readable. Rotation keeps the newest 60% past 512 KB.
public final class TobyLog: @unchecked Sendable {
	public static let shared = TobyLog()

	static let maxBytes = 512 * 1024
	static let levelOrder = ["error", "warn", "info", "debug"]
	static let sourceOrder = ["chat", "daemon", "server", "upgrade", "native-app", "macos-plugin"]

	private let lock = NSLock()
	private var directory: URL?

	public init(directory: URL? = nil) { self.directory = directory }

	/// Point the log at a Toby home (called when the runtime opens one).
	public func configure(tobyDirectory: URL) { lock.withLock { directory = tobyDirectory } }

	public var path: URL? { lock.withLock { directory?.appending(path: "logs/toby.log") } }

	static func truncate(_ value: JSONValue) -> JSONValue {
		switch value {
		case let .string(text) where text.count > 200: .string(String(text.prefix(200)) + "…")
		case let .array(items): .array(items.map(truncate))
		case let .object(object): .object(object.mapValues(truncate))
		default: value
		}
	}

	public func write(_ level: String, category: String, type: String, source: String = "native-app", sessionID: String? = nil, data: JSONValue? = nil, now: Date = Date()) {
		guard let path else { return }
		var entry: [String: JSONValue] = ["ts": .string(TodoRecurrence.isoString(now)), "source": .string(source), "level": .string(level), "category": .string(category), "type": .string(type)]
		if let sessionID { entry["sessionId"] = .string(sessionID) }
		if let data { entry["data"] = Self.truncate(data) }
		let line = Data((JSONValue.object(entry).jsonString() + "\n").utf8)
		lock.withLock {
			let fm = FileManager.default
			try? fm.createDirectory(at: path.deletingLastPathComponent(), withIntermediateDirectories: true)
			if !fm.fileExists(atPath: path.path) { fm.createFile(atPath: path.path, contents: nil) }
			guard let handle = try? FileHandle(forWritingTo: path) else { return }
			_ = try? handle.seekToEnd()
			try? handle.write(contentsOf: line)
			let size = (try? handle.offset()) ?? 0
			try? handle.close()
			if size > UInt64(Self.maxBytes), let text = try? String(contentsOf: path, encoding: .utf8) {
				let lines = text.split(separator: "\n")
				let keep = Int(Double(lines.count) * 0.6)
				if keep > 0, keep < lines.count {
					try? Data((lines.suffix(keep).joined(separator: "\n") + "\n").utf8).write(to: path, options: .atomic)
				}
			}
		}
	}

	public func info(_ category: String, _ type: String, _ data: JSONValue? = nil) { write("info", category: category, type: type, data: data) }
	public func warn(_ category: String, _ type: String, _ data: JSONValue? = nil) { write("warn", category: category, type: type, data: data) }
	public func error(_ category: String, _ type: String, _ data: JSONValue? = nil) { write("error", category: category, type: type, data: data) }

	public func entries() -> [JSONValue] {
		guard let path, let text = lock.withLock({ try? String(contentsOf: path, encoding: .utf8) }) else { return [] }
		return text.split(separator: "\n").compactMap { line in
			guard let value = try? JSONDecoder().decode(JSONValue.self, from: Data(line.utf8)), value["ts"]?.stringValue != nil else { return nil }
			return value
		}
	}

	public struct Filters: Sendable {
		public var source, level, category, type, query: String?
		public var limit: Int
		public init(source: String? = nil, level: String? = nil, category: String? = nil, type: String? = nil, query: String? = nil, limit: Int = 100) {
			(self.source, self.level, self.category, self.type, self.query, self.limit) = (source, level, category, type, query, limit)
		}
	}

	static func clean(_ value: String?) -> String? {
		let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		return trimmed.isEmpty ? nil : trimmed
	}

	static func matches(_ entry: JSONValue, _ f: Filters) -> Bool {
		if let source = clean(f.source), entry["source"]?.stringValue != source { return false }
		if let level = clean(f.level)?.lowercased(), entry["level"]?.stringValue?.lowercased() != level { return false }
		if let category = clean(f.category), entry["category"]?.stringValue != category { return false }
		if let type = clean(f.type), entry["type"]?.stringValue != type { return false }
		if let q = clean(f.query)?.lowercased() {
			let fields = ["level", "category", "type", "source", "sessionId", "ts"].compactMap { entry[$0]?.stringValue?.lowercased() }
			if !fields.contains(where: { $0.contains(q) }), !(entry["data"].map { $0.jsonString().lowercased().contains(q) } ?? false) { return false }
		}
		return true
	}

	static func facet(_ entries: [JSONValue], _ key: String, order: [String]? = nil) -> JSONValue {
		var counts: [String: Int] = [:]
		for entry in entries { counts[entry[key]?.stringValue ?? "", default: 0] += 1 }
		let known = (order ?? []).filter { counts[$0] != nil }
		let rest = counts.keys.filter { !(order ?? []).contains($0) }.sorted()
		return .array((known + rest).map { ["name": .string($0), "count": .number(Double(counts[$0]!))] })
	}

	/// `/api/logs` payload, newest first.
	public func query(_ f: Filters) -> JSONValue {
		let limit = f.limit < 1 ? 100 : min(f.limit, 2000)
		let all = entries()
		let filtered = all.filter { Self.matches($0, f) }
		func without(_ change: (inout Filters) -> Void) -> [JSONValue] {
			var copy = f
			change(&copy)
			return all.filter { Self.matches($0, copy) }
		}
		return [
			"logPath": .string(path?.path ?? ""), "entries": .array(filtered.suffix(limit).reversed()), "limit": .number(Double(limit)),
			"matched": .number(Double(filtered.count)), "hasMore": .bool(filtered.count > limit),
			"facets": [
				"sources": Self.facet(without { $0.source = nil }, "source", order: Self.sourceOrder),
				"levels": Self.facet(without { $0.level = nil }, "level", order: Self.levelOrder),
				"categories": Self.facet(without { $0.category = nil }, "category"),
				"types": Self.facet(without { $0.type = nil }, "type"),
			],
		]
	}
}
