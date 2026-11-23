import CryptoKit
import Foundation
import GRDB
import TobyAI
import TobyStore

/// Encrypted backups (port of `config/backup*.ts`, `database-backup.ts`,
/// `database-sync-backups.ts`), simplified for the Swift app:
///
/// - **Backup file** (`.tbybak`): `meta` (config.json + Keychain secrets),
///   `native-database` (toby.sqlite), project/recording/library files.
/// - **Data snapshots**: the same archive (no settings) written daily to the
///   sync vault under `data-backups/<deviceId>/`, newest 3 kept.
///
/// Restores are staged under the Toby home and applied at the next launch,
/// before the database opens. Older daemon backups (archives with a
/// `databases` section, or JSON envelopes) restore their legacy databases and
/// re-run the one-time import.
public struct BackupService: Sendable {
	public static let secretNames = MailAccount.fields.map { "mail.\($0)" } + SlackAccount.fields.map { "slack.\($0)" } + ["weather.apiKey"]
	static let pendingManifest = ".pending-restore.json"
	static let snapshotLimit = 3

	public let paths: TobyPaths
	let writer: any DatabaseWriter
	let secrets: any SecretStore
	let openRouter: (any APIKeyStore)?
	let passphrase: @Sendable () -> String?

	public init(paths: TobyPaths, writer: any DatabaseWriter, secrets: any SecretStore, openRouter: (any APIKeyStore)?,
	            passphrase: (@Sendable () -> String?)? = nil) {
		self.passphrase = passphrase ?? { TodoSyncSettings.passphrase(tobyDirectory: paths.root) }
		self.paths = paths
		self.writer = writer
		self.secrets = secrets
		self.openRouter = openRouter
	}

	public static func fileName(_ date: Date = Date()) -> String {
		"toby-config-backup-\(TodoRecurrence.isoString(date).replacingOccurrences(of: ":", with: "-").replacingOccurrences(of: ".", with: "-")).tbybak"
	}

	// MARK: Files

	public enum FileRoot: String, CaseIterable, Sendable { case projects, recordings, library }

	/// Every Toby-managed file tree as `(key, folder)` per root.
	func trees() throws -> [(FileRoot, String, URL)] {
		var out: [(FileRoot, String, URL)] = []
		var seen = Set<String>()
		let projects = try writer.read { db in try Row.fetchAll(db, sql: "SELECT id, folder_path FROM projects").map { ($0["id"] as String, $0["folder_path"] as String) } }
		for (id, folder) in projects where seen.insert(folder).inserted { out.append((.projects, id, URL(fileURLWithPath: folder))) }
		for (root, dir) in [(FileRoot.recordings, paths.listenRecordings), (.library, paths.library)] {
			for entry in (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.isDirectoryKey])) ?? [] where entry.lastPathComponent != ".tmp" && !entry.lastPathComponent.hasPrefix(".") {
				if (try? entry.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true { out.append((root, entry.lastPathComponent, entry)) }
			}
		}
		return out
	}

	/// Pack files into `<root>-files` sections plus `files-manifest`.
	func appendFiles(_ archive: BackupArchive.Writer) throws -> [String] {
		var entries: [JSONValue] = []
		var skipped: [String] = []
		var sections: [FileRoot: Data] = [:]
		for (root, key, folder) in try trees() {
			guard let enumerator = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey, .isRegularFileKey]) else { continue }
			let base = folder.standardizedFileURL.path
			let items = enumerator.compactMap { $0 as? URL }.sorted { $0.path < $1.path }
			for url in items {
				let rel = String(url.standardizedFileURL.path.dropFirst(base.count + 1))
				let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey, .isRegularFileKey])
				let mode = ((try? FileManager.default.attributesOfItem(atPath: url.path))?[.posixPermissions] as? Int ?? 0o644) & 0o777
				if values?.isSymbolicLink == true { skipped.append("\(root.rawValue)/\(key)/\(rel) (symbolic link)"); continue }
				if values?.isDirectory == true {
					entries.append(["type": "dir", "root": .string(root.rawValue), "key": .string(key), "path": .string(rel), "size": 0, "sha256": "", "mode": .number(Double(mode))])
					continue
				}
				guard values?.isRegularFile == true, let data = try? Data(contentsOf: url, options: .alwaysMapped) else { skipped.append("\(root.rawValue)/\(key)/\(rel) (file could not be read)"); continue }
				sections[root, default: Data()].append(data)
				let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
				entries.append(["type": "file", "root": .string(root.rawValue), "key": .string(key), "path": .string(rel), "size": .number(Double(data.count)), "sha256": .string(hash), "mode": .number(Double(mode))])
			}
		}
		for root in FileRoot.allCases { try archive.section("\(root.rawValue)-files", sections[root] ?? Data()) }
		try archive.section("files-manifest", Data(JSONValue.object([
			"version": 1, "roots": .array(FileRoot.allCases.map { .string($0.rawValue) }), "entries": .array(entries), "skipped": .array(skipped.map(JSONValue.string)),
		]).jsonString().utf8))
		return skipped
	}

	/// A consistent copy of the live database (`VACUUM INTO`).
	func databaseSnapshot() throws -> Data {
		_ = try FeedDatabase(writer: writer, home: paths.root)
		let tmp = FileManager.default.temporaryDirectory.appending(path: "toby-backup-\(UUID().uuidString).sqlite")
		defer { try? FileManager.default.removeItem(at: tmp) }
		try writer.writeWithoutTransaction { db in try db.execute(sql: "VACUUM INTO ?", arguments: [tmp.path]) }
		return try Data(contentsOf: tmp)
	}

	func secretsBag() -> [String: JSONValue] {
		var out: [String: JSONValue] = [:]
		for name in Self.secretNames { if let value = (try? secrets.secret(name)) ?? nil { out[name] = .string(value) } }
		if let key = (try? openRouter?.read()) ?? nil { out["openrouter.apiKey"] = .string(key) }
		return out
	}

	// MARK: Create

	/// Write a password-protected backup file; returns skipped paths.
	@discardableResult
	public func create(password: String, to url: URL) throws -> [String] {
		let archive = try BackupArchive.Writer(password: password, url: url)
		defer { archive.discard() }
		let config = (try? Data(contentsOf: paths.legacyConfig)).flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) } ?? [:]
		try archive.section("meta", Data(JSONValue.object(["version": 4, "createdAt": .string(TodoRecurrence.isoString(Date())), "config": config, "secrets": .object(secretsBag())]).jsonString().utf8))
		try archive.section("native-database", try databaseSnapshot())
		let skipped = try appendFiles(archive)
		try archive.finish()
		return skipped
	}

	// MARK: Restore (stage)

	public struct Staged: Sendable, Equatable {
		public var database: Bool
		public var legacy: Bool
		public var projects: Bool
		public var recordings: Bool
		public var library: Bool
		public var settings: Bool
	}

	static func safe(_ key: String, path: String) -> Bool {
		key.wholeMatch(of: /[a-zA-Z0-9._-]{1,256}/) != nil && !key.hasPrefix(".")
			&& !path.isEmpty && !path.hasPrefix("/") && !path.contains("\\") && !path.contains("\0") && !path.split(separator: "/", omittingEmptySubsequences: false).contains { $0.isEmpty || $0 == "." || $0 == ".." }
	}

	/// Validate and stage a backup file (or snapshot) for the next launch.
	@discardableResult
	public func restore(file url: URL, password: String, includeSettings: Bool = true) throws -> Staged {
		let pending = paths.root.appending(path: ".pending-restore-\(UUID().uuidString.prefix(8))")
		try FileManager.default.createDirectory(at: pending, withIntermediateDirectories: true)
		do {
			var staged = Staged(database: false, legacy: false, projects: false, recordings: false, library: false, settings: false)
			if BackupArchive.isArchive(url) {
				let reader = try BackupArchive.Reader(url, password: password)
				if reader.has("native-database") {
					try reader.section("native-database").write(to: pending.appending(path: "toby.sqlite"))
					staged.database = true
				} else if reader.has("databases") {
					try stageLegacyDatabases(try reader.section("databases"), into: pending)
					staged.database = true
					staged.legacy = true
				} else {
					throw BackupArchive.Failure("Backup archive is missing its databases section.")
				}
				if reader.has("files-manifest") {
					let roots = try stageFiles(reader, manifest: try JSONDecoder().decode(JSONValue.self, from: reader.section("files-manifest")), into: pending)
					staged.projects = roots.contains(.projects)
					staged.recordings = roots.contains(.recordings)
					staged.library = roots.contains(.library)
				}
				if includeSettings, reader.has("meta") {
					try reader.section("meta").write(to: pending.appending(path: "meta.json"))
					staged.settings = true
				}
			} else {
				// Older single-file JSON backups: settings + databases.
				let raw = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
				let payload: JSONValue
				if raw["format"] == "toby.config.backup.encrypted", let encryption = raw["encryption"], let ciphertext = raw["ciphertext"]?.stringValue {
					payload = try JSONDecoder().decode(JSONValue.self, from: PasswordEncryption.decrypt(encryption: encryption, ciphertext: ciphertext, password: password.trimmingCharacters(in: .whitespacesAndNewlines)))
				} else if raw["format"] == "toby.database.backup.encrypted", let encryption = raw["encryption"], let ciphertext = raw["ciphertext"]?.stringValue {
					payload = try JSONDecoder().decode(JSONValue.self, from: PasswordEncryption.decrypt(encryption: encryption, ciphertext: ciphertext, password: password.trimmingCharacters(in: .whitespacesAndNewlines)))
				} else {
					payload = raw
				}
				guard payload["config"] != nil || payload["databases"] != nil else { throw BackupArchive.Failure("Not a valid Toby config backup.") }
				if let databases = payload["databases"] {
					try stageLegacyDatabases(Data(databases.jsonString().utf8), into: pending)
					staged.database = true
					staged.legacy = true
				}
				if includeSettings, payload["config"] != nil {
					try Data(JSONValue.object(["version": 3, "config": payload["config"] ?? [:], "credentials": payload["credentials"] ?? [:]]).jsonString().utf8).write(to: pending.appending(path: "meta.json"))
					staged.settings = true
				}
			}
			let manifest: JSONValue = ["version": 1, "pendingDir": .string(pending.lastPathComponent), "database": .bool(staged.database), "legacy": .bool(staged.legacy),
			                           "projects": .bool(staged.projects), "recordings": .bool(staged.recordings), "library": .bool(staged.library), "settings": .bool(staged.settings)]
			try Data(manifest.jsonString().utf8).write(to: paths.root.appending(path: Self.pendingManifest), options: .atomic)
			return staged
		} catch {
			try? FileManager.default.removeItem(at: pending)
			throw error
		}
	}

	func stageLegacyDatabases(_ raw: Data, into pending: URL) throws {
		let bundle = try JSONDecoder().decode(JSONValue.self, from: raw)
		for name in ["chat", "memory"] {
			guard let snapshot = bundle[name], snapshot["compression"] == "gzip-base64", let encoded = snapshot["data"]?.stringValue, let gz = Data(base64Encoded: encoded) else {
				throw BackupArchive.Failure("Not a valid Toby database backup.")
			}
			let bytes = try BackupArchive.gunzip(gz)
			let hash = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
			guard hash == snapshot["sha256"]?.stringValue else { throw BackupArchive.Failure("Database backup failed its integrity check.") }
			try bytes.write(to: pending.appending(path: "\(name).sqlite"))
		}
	}

	func stageFiles(_ reader: BackupArchive.Reader, manifest: JSONValue, into pending: URL) throws -> Set<FileRoot> {
		guard manifest["version"] == 1, let entries = manifest["entries"]?.arrayValue else { throw BackupArchive.Failure("Backup archive file manifest is invalid.") }
		var staged = Set<FileRoot>()
		for root in (manifest["roots"]?.arrayValue ?? []).compactMap({ $0.stringValue.flatMap(FileRoot.init) }) {
			let section = try reader.section("\(root.rawValue)-files")
			let destination = pending.appending(path: root.rawValue)
			try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
			staged.insert(root)
			var cursor = section.startIndex
			for entry in entries where entry["root"]?.stringValue == root.rawValue {
				let key = entry["key"]?.stringValue ?? "", path = entry["path"]?.stringValue ?? ""
				guard Self.safe(key, path: path) else { throw BackupArchive.Failure("Backup archive contains an unsafe file path.") }
				let target = destination.appending(path: key).appending(path: path)
				if entry["type"] == "dir" {
					try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
					continue
				}
				let size = entry["size"]?.intValue ?? 0
				guard cursor + size <= section.endIndex else { throw BackupArchive.Failure("Backup file section ended early.") }
				let bytes = section.subdata(in: cursor ..< cursor + size)
				cursor += size
				guard SHA256.hash(data: bytes).map({ String(format: "%02x", $0) }).joined() == entry["sha256"]?.stringValue else {
					throw BackupArchive.Failure("Backup file \"\(root.rawValue)/\(key)/\(path)\" failed its integrity check.")
				}
				try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
				try bytes.write(to: target)
				try? FileManager.default.setAttributes([.posixPermissions: entry["mode"]?.intValue ?? 0o600], ofItemAtPath: target.path)
			}
			guard cursor == section.endIndex else { throw BackupArchive.Failure("Backup file section has trailing data.") }
		}
		return staged
	}

	// MARK: Apply (at launch, before the database opens)

	public static func hasPending(_ paths: TobyPaths) -> Bool { FileManager.default.fileExists(atPath: paths.root.appending(path: pendingManifest).path) }

	/// Swap staged data into place. Legacy databases go to `chat.sqlite`/
	/// `memory.sqlite` and the native database is set aside so the import re-runs.
	/// Returns the restored project ids (their folders are repointed after open).
	@discardableResult
	public static func applyPending(_ paths: TobyPaths, secrets: any SecretStore, openRouter: (any APIKeyStore)?) throws -> [String] {
		let manifestURL = paths.root.appending(path: pendingManifest)
		guard let manifest = (try? Data(contentsOf: manifestURL)).flatMap({ try? JSONDecoder().decode(JSONValue.self, from: $0) }),
		      let dirName = manifest["pendingDir"]?.stringValue, dirName == (dirName as NSString).lastPathComponent else { return [] }
		let fm = FileManager.default
		let pending = paths.root.appending(path: dirName)
		var swaps: [(live: URL, staged: URL)] = []
		if manifest["database"] == true {
			// A database from another backup must never adopt this home's loose Feed files.
			let marker = pending.appending(path: FeedDatabase.restoredHomeMarker)
			try Data().write(to: marker, options: .atomic)
			swaps.append((paths.root.appending(path: FeedDatabase.restoredHomeMarker), marker))
			if manifest["legacy"] == true {
				swaps.append((paths.legacyChatDatabase, pending.appending(path: "chat.sqlite")))
				swaps.append((paths.legacyMemoryDatabase, pending.appending(path: "memory.sqlite")))
			} else {
				swaps.append((paths.database, pending.appending(path: "toby.sqlite")))
			}
		}
		if manifest["projects"] == true { swaps.append((paths.projects, pending.appending(path: "projects"))) }
		if manifest["recordings"] == true { swaps.append((paths.listenRecordings, pending.appending(path: "recordings"))) }
		if manifest["library"] == true { swaps.append((paths.library, pending.appending(path: "library"))) }
		var applied: [(live: URL, backup: URL)] = []
		do {
			for swap in swaps {
				guard fm.fileExists(atPath: swap.staged.path) else { throw BackupArchive.Failure("Staged restore is incomplete.") }
				try fm.createDirectory(at: swap.live.deletingLastPathComponent(), withIntermediateDirectories: true)
				let backup = URL(fileURLWithPath: swap.live.path + ".pre-restore")
				try? fm.removeItem(at: backup)
				if fm.fileExists(atPath: swap.live.path) { try fm.moveItem(at: swap.live, to: backup) }
				for sidecar in ["-wal", "-shm"] { try? fm.removeItem(atPath: swap.live.path + sidecar) }
				try fm.moveItem(at: swap.staged, to: swap.live)
				applied.append((swap.live, backup))
			}
		} catch {
			for item in applied.reversed() {
				try? fm.removeItem(at: item.live)
				if fm.fileExists(atPath: item.backup.path) { try? fm.moveItem(at: item.backup, to: item.live) }
			}
			throw error
		}
		for item in applied { try? fm.removeItem(at: item.backup) }
		if manifest["legacy"] == true {
			// Re-run the one-time import from the restored legacy databases.
			for suffix in ["", "-wal", "-shm"] { try? fm.removeItem(atPath: paths.database.path + suffix) }
		}
		if manifest["settings"] == true, let meta = (try? Data(contentsOf: pending.appending(path: "meta.json"))).flatMap({ try? JSONDecoder().decode(JSONValue.self, from: $0) }) {
			if let config = meta["config"], config.objectValue != nil {
				var data = try JSONEncoder.tobyPretty.encode(config)
				data.append(10)
				try data.write(to: paths.legacyConfig, options: .atomic)
			}
			if let bag = meta["secrets"]?.objectValue {
				for (name, value) in bag {
					guard let text = value.stringValue else { continue }
					if name == "openrouter.apiKey" { try? openRouter?.save(text) } else { try? secrets.setSecret(text, for: name) }
				}
			} else if let credentials = meta["credentials"] {
				let mapping = LegacySecretMapping.from(credentials: credentials)
				for (name, value) in mapping.secrets { try? secrets.setSecret(value, for: name) }
				if let key = mapping.openRouterKey { try? openRouter?.save(key) }
			}
		}
		let projects: [String] = manifest["projects"] == true
			? ((try? fm.contentsOfDirectory(atPath: paths.projects.path)) ?? []).filter { !$0.hasPrefix(".") } : []
		try? fm.removeItem(at: manifestURL)
		try? fm.removeItem(at: pending)
		return projects
	}

	/// Point restored projects at their Toby-managed folders on this Mac.
	public static func repointProjects(_ ids: [String], writer: any DatabaseWriter, projectsDir: URL) throws {
		guard !ids.isEmpty else { return }
		try writer.write { db in
			for id in ids { try db.execute(sql: "UPDATE projects SET folder_path = ? WHERE id = ?", arguments: [projectsDir.appending(path: id).path, id]) }
		}
	}

	// MARK: Daily data snapshots (sync vault)

	public struct Snapshot: Sendable {
		public var filename: String
		public var deviceID: String
		public var deviceName: String
		public var createdAt: String
		public var path: String
		var json: JSONValue {
			["filename": .string(filename), "deviceId": .string(deviceID), "deviceName": .string(deviceName), "createdAt": .string(createdAt), "path": .string(path),
			 "includesProjects": true, "includesRecordings": true, "includesLibrary": true]
		}
	}

	func syncState() -> [String: JSONValue] {
		(try? Data(contentsOf: paths.root.appending(path: "sync-state.json"))).flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) }?.objectValue ?? [:]
	}

	func updateSyncState(_ body: (inout [String: JSONValue]) -> Void) {
		var state = syncState()
		body(&state)
		if let data = try? JSONEncoder.tobyPretty.encode(JSONValue.object(state)) { try? data.write(to: paths.root.appending(path: "sync-state.json"), options: .atomic) }
	}

	func vault() -> URL { URL(fileURLWithPath: TodoSyncSettings.read(tobyDirectory: paths.root).vaultRoot()).appending(path: "data-backups") }

	public var snapshotsEnabled: Bool { syncState()["enabled"] == true && syncState()["databaseBackupsEnabled"] == true }

	public func setSnapshotsEnabled(_ enabled: Bool) { updateSyncState { $0["databaseBackupsEnabled"] = .bool(enabled) } }

	static var deviceName: String { Host.current().localizedName ?? "Mac" }

	/// Write today's snapshot to the vault and prune to the newest three.
	@discardableResult
	public func createSnapshot(now: Date = Date()) throws -> Snapshot {
		let settings = TodoSyncSettings.read(tobyDirectory: paths.root)
		guard snapshotsEnabled, !settings.deviceID.isEmpty else { throw BackupArchive.Failure("Data backups are not enabled.") }
		guard let password = passphrase() else { throw BackupArchive.Failure("Sync password is missing from Keychain.") }
		let createdAt = TodoRecurrence.isoString(now)
		let filename = "\(createdAt.replacingOccurrences(of: ":", with: "-").replacingOccurrences(of: ".", with: "-")).tbybak"
		let url = vault().appending(path: settings.deviceID).appending(path: filename)
		let archive = try BackupArchive.Writer(password: password, url: url)
		defer { archive.discard() }
		try archive.section("native-database", try databaseSnapshot())
		_ = try appendFiles(archive)
		try archive.finish(info: ["deviceId": settings.deviceID, "deviceName": Self.deviceName, "kind": "database", "createdAt": createdAt])
		let mine = snapshots().filter { $0.deviceID == settings.deviceID }.sorted { $0.createdAt > $1.createdAt }
		for old in mine.dropFirst(Self.snapshotLimit) { try? FileManager.default.removeItem(atPath: old.path) }
		updateSyncState { $0["lastDatabaseBackupAt"] = .string(createdAt); $0["lastDatabaseBackupError"] = .null }
		return Snapshot(filename: filename, deviceID: settings.deviceID, deviceName: Self.deviceName, createdAt: createdAt, path: url.path)
	}

	/// Every device's snapshots in the vault, newest first.
	public func snapshots() -> [Snapshot] {
		let fm = FileManager.default
		var out: [Snapshot] = []
		for device in (try? fm.contentsOfDirectory(atPath: vault().path)) ?? [] where device.wholeMatch(of: /[a-zA-Z0-9_-]+/) != nil {
			for name in (try? fm.contentsOfDirectory(atPath: vault().appending(path: device).path)) ?? [] where name.hasSuffix(".tbybak") || name.hasSuffix(".json") {
				let url = vault().appending(path: device).appending(path: name)
				let info = (try? BackupArchive.Reader.header(url))?.header["info"]
				let legacy = name.hasSuffix(".json") ? (try? Data(contentsOf: url)).flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) } : nil
				out.append(Snapshot(filename: name, deviceID: device, deviceName: info?["deviceName"]?.stringValue ?? legacy?["deviceName"]?.stringValue ?? device,
				                    createdAt: info?["createdAt"]?.stringValue ?? legacy?["createdAt"]?.stringValue ?? name, path: url.path))
			}
		}
		return out.sorted { $0.createdAt > $1.createdAt }
	}

	public func snapshotsJSON() -> JSONValue { .array(snapshots().map(\.json)) }

	/// Stage a vault snapshot (data only; settings untouched).
	public func restoreSnapshot(deviceID: String, filename: String) throws -> Staged {
		guard deviceID.wholeMatch(of: /[a-zA-Z0-9_-]+/) != nil, filename == (filename as NSString).lastPathComponent else { throw BackupArchive.Failure("Invalid database backup path.") }
		guard let password = passphrase() else { throw BackupArchive.Failure("Sync password is missing from Keychain.") }
		return try restore(file: vault().appending(path: deviceID).appending(path: filename), password: password, includeSettings: false)
	}

	/// Daily tick: snapshot when enabled and 24h have passed.
	public func runSnapshotLoop() async {
		while !Task.isCancelled {
			let last = syncState()["lastDatabaseBackupAt"]?.stringValue.flatMap(TodoRecurrence.parseISO)
			if snapshotsEnabled, last.map({ Date().timeIntervalSince($0) >= 86400 }) ?? true {
				do {
					let snapshot = try createSnapshot()
					TobyLog.shared.info("backup", "data_snapshot_created", ["filename": .string(snapshot.filename)])
				} catch {
					TobyLog.shared.warn("backup", "data_snapshot_failed", ["error": .string((error as? LocalizedError)?.errorDescription ?? "\(error)")])
					updateSyncState { $0["lastDatabaseBackupError"] = .string((error as? LocalizedError)?.errorDescription ?? "\(error)") }
				}
			}
			try? await Task.sleep(for: .seconds(3600))
		}
	}
}
