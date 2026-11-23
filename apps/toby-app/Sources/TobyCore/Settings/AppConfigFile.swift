import Foundation
import TobyAI

/// `config.json` in the Toby home: read a value at a key path, or set one
/// (nil removes it). Unknown keys are preserved.
public struct AppConfigFile: Sendable {
	public let url: URL

	public init(tobyDirectory: URL) { url = tobyDirectory.appending(path: "config.json") }

	public func read() -> [String: JSONValue] {
		(try? Data(contentsOf: url)).flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) }?.objectValue ?? [:]
	}

	public func value(_ path: String) -> JSONValue? {
		var current: JSONValue? = .object(read())
		for key in path.split(separator: ".") { current = current?[String(key)] }
		return current
	}

	public func set(_ path: String, _ value: JSONValue?) throws {
		try set([(path, value)])
	}

	/// Apply several key-path writes in one file update.
	public func set(_ changes: [(String, JSONValue?)]) throws {
		var root = read()
		for (path, value) in changes {
			Self.assign(&root, Array(path.split(separator: ".").map(String.init)), value)
		}
		try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
		var data = try JSONEncoder.tobyPretty.encode(JSONValue.object(root))
		data.append(10)
		try data.write(to: url, options: .atomic)
	}

	static func assign(_ object: inout [String: JSONValue], _ keys: [String], _ value: JSONValue?) {
		guard let first = keys.first else { return }
		if keys.count == 1 {
			object[first] = value
			return
		}
		var child = object[first]?.objectValue ?? [:]
		assign(&child, Array(keys.dropFirst()), value)
		object[first] = .object(child)
	}
}
