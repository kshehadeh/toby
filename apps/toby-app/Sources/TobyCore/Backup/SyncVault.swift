import Foundation
import Security
import TobyAI

/// The sync vault that todo sync and data snapshots share (`Toby/sync` in
/// iCloud Drive or a chosen folder). Settings sync is gone: enabling only
/// records the backend and stores the vault password; joining an existing
/// vault checks the password against `settings.json` when one exists.
public struct SyncVault: Sendable {
	public struct Passphrase: Sendable {
		public var read: @Sendable () -> String?
		public var write: @Sendable (String) throws -> Void
		public var delete: @Sendable () -> Void

		public init(read: @escaping @Sendable () -> String?, write: @escaping @Sendable (String) throws -> Void, delete: @escaping @Sendable () -> Void) {
			self.read = read
			self.write = write
			self.delete = delete
		}

		public static func keychain(tobyDirectory: URL) -> Passphrase {
			Passphrase(
				read: { TodoSyncSettings.passphrase(tobyDirectory: tobyDirectory) },
				write: { value in
					do { try TobyKeychain.shared.set(value, for: "sync.passphrase") } catch {
						throw BackupArchive.Failure("Could not save the sync password to Keychain (\(error.localizedDescription)).")
					}
				},
				delete: {
					try? TobyKeychain.shared.set(nil, for: "sync.passphrase")
					try? FileManager.default.removeItem(at: tobyDirectory.appending(path: "sync-passphrase"))
				},
			)
		}
	}

	let tobyDirectory: URL
	let passphrase: Passphrase
	let environment: [String: String]
	let iCloudRoot: String?

	public init(tobyDirectory: URL, passphrase: Passphrase, environment: [String: String] = ProcessInfo.processInfo.environment, iCloudRoot: String? = nil) {
		self.tobyDirectory = tobyDirectory
		self.passphrase = passphrase
		self.environment = environment
		self.iCloudRoot = iCloudRoot
	}

	var stateURL: URL { tobyDirectory.appending(path: "sync-state.json") }

	func state() -> [String: JSONValue] {
		(try? Data(contentsOf: stateURL)).flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) }?.objectValue ?? [:]
	}

	func write(_ state: [String: JSONValue]) throws {
		var data = try JSONEncoder.tobyPretty.encode(JSONValue.object(state))
		data.append(10)
		try data.write(to: stateURL, options: .atomic)
	}

	var iCloudDrive: URL {
		URL(fileURLWithPath: iCloudRoot.map { ($0 as NSString).deletingLastPathComponent } ?? FileManager.default.homeDirectoryForCurrentUser.path + "/Library/Mobile Documents/com~apple~CloudDocs")
	}

	var iCloudAvailable: Bool { FileManager.default.fileExists(atPath: iCloudDrive.path) }

	/// `/api/config/sync` (the app's `ConfigSyncStatus`).
	public func status() -> JSONValue {
		var current = state()
		if current["deviceId"]?.stringValue?.isEmpty ?? true {
			current["deviceId"] = .string(UUID().uuidString.lowercased())
			current["version"] = 1
			try? write(current)
		}
		let settings = TodoSyncSettings.read(tobyDirectory: tobyDirectory)
		let root = settings.vaultRoot(environment: environment, iCloudRoot: iCloudRoot)
		let storeAvailable = settings.backend == "folder"
			? FileManager.default.fileExists(atPath: settings.folderPath ?? "/nonexistent")
			: iCloudAvailable
		var out: [String: JSONValue] = [
			"enabled": .bool(current["enabled"] == true), "iCloudAvailable": .bool(iCloudAvailable), "backend": .string(settings.backend),
			"storeAvailable": .bool(storeAvailable), "deviceId": current["deviceId"] ?? "", "deviceName": .string(Host.current().localizedName ?? "Mac"),
			"vaultPath": .string(root), "lastAckedLamport": current["lastAckedLamport"] ?? 0, "lastAckedContentHash": current["lastAckedContentHash"] ?? "",
			"dirty": false, "hasRemote": .bool(FileManager.default.fileExists(atPath: root + "/settings.json")),
			"databaseBackupsEnabled": .bool(current["databaseBackupsEnabled"] == true),
		]
		if settings.backend == "folder", let folder = settings.folderPath { out["folderPath"] = .string(folder) }
		for key in ["lastPushAt", "lastPullAt", "lastError", "lastWriterDeviceName", "lastWriterDeviceId", "lastDatabaseBackupAt", "lastDatabaseBackupError"] {
			if let value = current[key], value != .null { out[key] = value }
		}
		return .object(out)
	}

	/// Turn the vault on for this Mac (`mode`: join / create / replace).
	public func enable(password: String, mode: String?, backend: String?, folderPath: String?) throws -> JSONValue {
		let trimmed = password.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else { throw BackupArchive.Failure("Sync password cannot be empty.") }
		var next = state()
		let resolvedBackend = backend == "folder" ? "folder" : (backend == "icloud" ? "icloud" : (next["backend"]?.stringValue ?? "icloud"))
		var folder: String?
		if resolvedBackend == "folder" {
			let picked = (folderPath ?? next["folderPath"]?.stringValue ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
			var isDirectory: ObjCBool = false
			guard !picked.isEmpty, FileManager.default.fileExists(atPath: picked, isDirectory: &isDirectory), isDirectory.boolValue else {
				throw BackupArchive.Failure("Choose a folder that exists on this Mac.")
			}
			folder = TodoSyncSettings.resolve(picked)
		} else if !iCloudAvailable {
			throw BackupArchive.Failure("iCloud Drive is not available. Sign in to iCloud and turn on iCloud Drive, or choose a folder instead.")
		}
		let root = TodoSyncSettings(enabled: true, backend: resolvedBackend, folderPath: folder, deviceID: "").vaultRoot(environment: environment, iCloudRoot: iCloudRoot)
		let settingsFile = URL(fileURLWithPath: root + "/settings.json")
		if mode != "replace", let data = try? Data(contentsOf: settingsFile), let envelope = try? JSONDecoder().decode(JSONValue.self, from: data),
		   let encryption = envelope["encryption"], let ciphertext = envelope["ciphertext"]?.stringValue {
			_ = try PasswordEncryption.decrypt(encryption: encryption, ciphertext: ciphertext, password: trimmed)
		}
		try FileManager.default.createDirectory(atPath: root, withIntermediateDirectories: true)
		try passphrase.write(trimmed)
		if next["deviceId"]?.stringValue?.isEmpty ?? true { next["deviceId"] = .string(UUID().uuidString.lowercased()) }
		if next["vaultPath"]?.stringValue != root { next["lastDatabaseBackupAt"] = nil; next["lastDatabaseBackupError"] = .null }
		next["version"] = 1
		next["enabled"] = true
		next["backend"] = .string(resolvedBackend)
		next["folderPath"] = folder.map(JSONValue.string)
		next["vaultPath"] = .string(root)
		next["lastError"] = .null
		try write(next)
		return status()
	}

	/// Turn the vault off for this Mac; optionally delete its cloud copy.
	public func disable(deleteCloud: Bool) throws -> JSONValue {
		if deleteCloud {
			let root = TodoSyncSettings.read(tobyDirectory: tobyDirectory).vaultRoot(environment: environment, iCloudRoot: iCloudRoot)
			if FileManager.default.fileExists(atPath: root) { try FileManager.default.removeItem(atPath: root) }
		}
		passphrase.delete()
		var next = state()
		next["enabled"] = false
		next["lastError"] = .null
		try write(next)
		return status()
	}
}
