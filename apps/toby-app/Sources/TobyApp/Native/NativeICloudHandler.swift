import Foundation

/// Coordinated I/O for the iCloud Drive vault folder.
///
/// Crypto stays in the daemon. This handler only reads/writes JSON envelopes
/// under iCloud Drive → Toby → config-sync, including conflict copies and
/// dataless placeholder downloads.
@MainActor
enum NativeICloudHandler {
	static let historyLimit = 10
	static let vaultFileName = "vault.json"

	/// Tests inject a directory so CI never touches the real iCloud Drive.
	static var rootOverride: URL?

	static func resolveCloudDocsDirectory() -> URL {
		FileManager.default.homeDirectoryForCurrentUser
			.appendingPathComponent("Library/Mobile Documents/com~apple~CloudDocs")
	}

	static func resolveRoot() -> URL {
		if let rootOverride {
			return rootOverride
		}
		return resolveCloudDocsDirectory().appendingPathComponent("Toby/config-sync")
	}

	static func status() -> Data {
		let cloudDocs = resolveCloudDocsDirectory()
		let available = FileManager.default.fileExists(atPath: cloudDocs.path)
		let root = resolveRoot()
		return json([
			"ok": true,
			"data": [
				"available": available || rootOverride != nil,
				"cloudDocsPath": cloudDocs.path,
				"vaultPath": root.path,
			],
		])
	}

	static func ensure(body: Data?) -> Data {
		do {
			let filename = stringValue(parseObject(body)?["filename"]) ?? Self.vaultFileName
			let url = try resolvedFileURL(filename: filename)
			try ensureDownloaded(url)
			return json(["ok": true, "data": ["path": url.path]])
		} catch {
			return json(["ok": false, "error": error.localizedDescription])
		}
	}

	static func read(body: Data?) -> Data {
		do {
			let filename = stringValue(parseObject(body)?["filename"]) ?? Self.vaultFileName
			let url = try resolvedFileURL(filename: filename)
			try ensureDownloaded(url)
			guard FileManager.default.fileExists(atPath: url.path) else {
				return json(["ok": true, "data": ["envelope": NSNull()]])
			}
			let data = try coordinatedRead(url)
			guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
				return json(["ok": false, "error": "Vault file is not valid JSON."])
			}
			return json(["ok": true, "data": ["envelope": object]])
		} catch {
			return json(["ok": false, "error": error.localizedDescription])
		}
	}

	static func write(body: Data?) -> Data {
		guard let input = parseObject(body),
			let envelope = input["envelope"] as? [String: Any],
			JSONSerialization.isValidJSONObject(envelope)
		else {
			return json(["ok": false, "error": "envelope object is required."])
		}
		do {
			let root = resolveRoot()
			let historyDir = root.appendingPathComponent("history")
			try FileManager.default.createDirectory(at: historyDir, withIntermediateDirectories: true)
			let vaultURL = root.appendingPathComponent(Self.vaultFileName)
			if FileManager.default.fileExists(atPath: vaultURL.path) {
				let previous = try coordinatedRead(vaultURL)
				if let previousObject = try JSONSerialization.jsonObject(with: previous) as? [String: Any] {
					let name = historyFileName(from: previousObject)
					try coordinatedWrite(historyDir.appendingPathComponent(name), jsonObject: previousObject)
				}
			}
			try coordinatedWrite(vaultURL, jsonObject: envelope)
			try pruneHistory(in: historyDir)
			return json(["ok": true, "data": ["path": vaultURL.path]])
		} catch {
			return json(["ok": false, "error": error.localizedDescription])
		}
	}

	static func history() -> Data {
		do {
			let dir = resolveRoot().appendingPathComponent("history")
			guard FileManager.default.fileExists(atPath: dir.path) else {
				return json(["ok": true, "data": ["history": []]])
			}
			let names = try FileManager.default.contentsOfDirectory(atPath: dir.path)
				.filter { $0.hasSuffix(".json") }
				.sorted(by: >)
			return json(["ok": true, "data": ["history": names]])
		} catch {
			return json(["ok": false, "error": error.localizedDescription])
		}
	}

	static func deleteAll() -> Data {
		do {
			let root = resolveRoot()
			if FileManager.default.fileExists(atPath: root.path) {
				try FileManager.default.removeItem(at: root)
			}
			return json(["ok": true, "data": ["deleted": true]])
		} catch {
			return json(["ok": false, "error": error.localizedDescription])
		}
	}

	// MARK: - Paths

	static func resolvedFileURL(filename: String) throws -> URL {
		let safe = (filename as NSString).lastPathComponent
		guard safe == filename || filename.hasPrefix("history/") else {
			throw NSError(
				domain: "toby.icloud",
				code: 1,
				userInfo: [NSLocalizedDescriptionKey: "Invalid vault filename."],
			)
		}
		let root = resolveRoot()
		if filename.hasPrefix("history/") {
			return root.appendingPathComponent(filename)
		}
		if safe != Self.vaultFileName, safe.hasPrefix("vault") {
			// iCloud conflict copies live beside the current vault.
			return root.appendingPathComponent(safe)
		}
		if safe == Self.vaultFileName {
			return root.appendingPathComponent(Self.vaultFileName)
		}
		return root.appendingPathComponent("history").appendingPathComponent(safe)
	}

	// MARK: - Coordination

	private static func ensureDownloaded(_ url: URL) throws {
		let fm = FileManager.default
		guard fm.isUbiquitousItem(at: url) else { return }
		try fm.startDownloadingUbiquitousItem(at: url)
		let deadline = Date().addingTimeInterval(3)
		while Date() < deadline {
			let values = try url.resourceValues(forKeys: [
				.ubiquitousItemDownloadingStatusKey,
			])
			if values.ubiquitousItemDownloadingStatus == .current {
				return
			}
			Thread.sleep(forTimeInterval: 0.15)
		}
	}

	private static func coordinatedRead(_ url: URL) throws -> Data {
		var result: Data?
		var coordError: NSError?
		NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordError) { readURL in
			result = try? Data(contentsOf: readURL)
		}
		if let coordError { throw coordError }
		guard let result else {
			throw NSError(
				domain: "toby.icloud",
				code: 2,
				userInfo: [NSLocalizedDescriptionKey: "Could not read \(url.lastPathComponent)."],
			)
		}
		return result
	}

	private static func coordinatedWrite(_ url: URL, jsonObject: [String: Any]) throws {
		let data = try JSONSerialization.data(withJSONObject: jsonObject, options: [.prettyPrinted, .sortedKeys])
		var coordError: NSError?
		NSFileCoordinator().coordinate(
			writingItemAt: url,
			options: .forReplacing,
			error: &coordError,
		) { writeURL in
			try? data.write(to: writeURL, options: .atomic)
		}
		if let coordError { throw coordError }
	}

	private static func pruneHistory(in dir: URL) throws {
		let fm = FileManager.default
		guard fm.fileExists(atPath: dir.path) else { return }
		let files = try fm.contentsOfDirectory(atPath: dir.path)
			.filter { $0.hasSuffix(".json") }
			.sorted(by: >)
		if files.count <= historyLimit { return }
		for extra in files.dropFirst(historyLimit) {
			try? fm.removeItem(at: dir.appendingPathComponent(extra))
		}
	}

	private static func historyFileName(from envelope: [String: Any]) -> String {
		let clock = envelope["clock"] as? [String: Any]
		let utc = (clock?["utc"] as? String) ?? ISO8601DateFormatter().string(from: Date())
		let lamport = clock?["lamport"] ?? 0
		let stamp = utc.replacingOccurrences(of: ":", with: "-").replacingOccurrences(of: ".", with: "-")
		return "\(stamp)-l\(lamport).json"
	}

	private static func parseObject(_ body: Data?) -> [String: Any]? {
		guard let body,
			let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
		else { return [:] }
		return object
	}

	private static func stringValue(_ value: Any?) -> String? {
		guard let value = value as? String, !value.isEmpty else { return nil }
		return value
	}

	private static func json(_ payload: [String: Any]) -> Data {
		guard JSONSerialization.isValidJSONObject(payload),
			let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
		else {
			return Data("{\"ok\":false,\"error\":\"encoding error\"}".utf8)
		}
		return data
	}
}
