import Foundation

/// Transport only. Authentication, decryption, and todo validation stay in core.
@MainActor
enum NativeTodoSyncHandler {
	static let maxBatchBytes = 2 * 1024 * 1024

	static func handle(_ action: String, body: Data?) -> Data {
		do {
			let input = body.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
			switch action {
			case "list":
				let root = try batchRoot()
				guard FileManager.default.fileExists(atPath: root.path) else { return response(["files": []]) }
				let replicas = try FileManager.default.contentsOfDirectory(atPath: root.path)
				var files: [String] = []
				for replica in replicas where replica.range(of: "^[a-zA-Z0-9_-]{1,200}$", options: .regularExpression) != nil {
					let folder = root.appendingPathComponent(replica)
					try rejectSymlink(folder, under: root)
					var isDirectory: ObjCBool = false
					guard FileManager.default.fileExists(atPath: folder.path, isDirectory: &isDirectory), isDirectory.boolValue else { continue }
					for file in try FileManager.default.contentsOfDirectory(atPath: folder.path) {
						if file.range(of: "^[a-zA-Z0-9_-]{1,200}\\.json$", options: .regularExpression) != nil {
							files.append("\(replica)/\(file)")
						}
						// iCloud's dataless placeholder name is `.batch.json.icloud`.
						else if file.hasPrefix("."), file.hasSuffix(".json.icloud") {
							let logical = String(file.dropFirst().dropLast(7))
							if logical.range(of: "^[a-zA-Z0-9_-]{1,200}\\.json$", options: .regularExpression) != nil {
								files.append("\(replica)/\(logical)")
							}
						}
					}
				}
				return response(["files": Array(Set(files)).sorted()])
			case "read":
				let url = try batchURL(input["name"] as? String)
				try NativeICloudHandler.ensureDownloaded(url)
				let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
				guard let size = attributes[.size] as? NSNumber, size.intValue <= maxBatchBytes else { throw failure("Todo batch is too large.") }
				let data = try NativeICloudHandler.coordinatedRead(url)
				guard data.count <= maxBatchBytes, let contents = String(data: data, encoding: .utf8) else { throw failure("Invalid todo batch.") }
				return response(["contents": contents])
			case "write":
				let url = try batchURL(input["name"] as? String)
				guard let contents = input["contents"] as? String, contents.utf8.count <= maxBatchBytes,
					let data = contents.data(using: .utf8),
					let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any],
					envelope["format"] as? String == "toby.todos.operations.encrypted"
				else { throw failure("An encrypted todo batch is required.") }
				try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
				var coordinationError: NSError?
				var writeError: Error?
				NSFileCoordinator().coordinate(writingItemAt: url, options: [], error: &coordinationError) { destination in
					let temporary = destination.deletingLastPathComponent().appendingPathComponent(".\(UUID().uuidString).tmp")
					defer { try? FileManager.default.removeItem(at: temporary) }
					do {
						try data.write(to: temporary, options: .withoutOverwriting)
						try FileManager.default.moveItem(at: temporary, to: destination)
					} catch { writeError = error }
				}
				if let coordinationError { throw coordinationError }
				if let writeError { throw writeError }
				return response(["written": true])
			default:
				throw failure("Unknown todo sync operation.")
			}
		} catch {
			return encode(["ok": false, "error": error.localizedDescription])
		}
	}

	static func batchURL(_ name: String?) throws -> URL {
		guard let name, name.range(of: "^[a-zA-Z0-9_-]{1,200}/[a-zA-Z0-9_-]{1,200}\\.json$", options: .regularExpression) != nil else {
			throw failure("Invalid todo batch filename.")
		}
		let root = try batchRoot()
		let url = root.appendingPathComponent(name)
		try rejectSymlink(url.deletingLastPathComponent(), under: root)
		try rejectSymlink(url, under: root)
		return url
	}

	private static func batchRoot() throws -> URL {
		let vault = NativeICloudHandler.resolveRoot()
		let root = vault.appendingPathComponent("todos/v1")
		try rejectSymlink(vault.appendingPathComponent("todos"), under: vault)
		try rejectSymlink(root, under: vault)
		return root
	}

	private static func rejectSymlink(_ url: URL, under root: URL) throws {
		let canonicalRoot = root.resolvingSymlinksInPath().standardizedFileURL
		let expected = canonicalRoot.appendingPathComponent(String(url.path.dropFirst(root.path.count + 1))).standardizedFileURL
		guard url.resolvingSymlinksInPath().standardizedFileURL == expected else {
			throw failure("Todo sync paths must not contain symbolic links.")
		}
	}

	private static func failure(_ message: String) -> NSError {
		NSError(domain: "toby.todos.sync", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
	}
	private static func response(_ data: [String: Any]) -> Data { encode(["ok": true, "data": data]) }
	private static func encode(_ object: [String: Any]) -> Data {
		(try? JSONSerialization.data(withJSONObject: object, options: .sortedKeys)) ?? Data(#"{"ok":false}"#.utf8)
	}
}
