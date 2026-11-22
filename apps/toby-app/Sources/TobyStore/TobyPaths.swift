import Foundation

/// Filesystem layout of a Toby home (`TOBY_DIR`).
///
/// Legacy (daemon) data lives at the root; Swift-owned data lives under `app/`
/// (the root `toby.sqlite` name is taken by a stale 0-byte file on older installs).
public struct TobyPaths: Sendable, Hashable {
	public static let tobyDirDefaultsKey = "toby.general.tobyDir"

	public let root: URL

	public init(root: URL) {
		self.root = root.standardizedFileURL
	}

	/// Resolve the active Toby home: `TOBY_DIR`, then the Settings preference, then `~/.toby`.
	public static func current(
		environment: [String: String] = ProcessInfo.processInfo.environment,
		defaults: UserDefaults = .standard,
	) -> TobyPaths {
		if let override = environment["TOBY_DIR"]?.trimmingCharacters(in: .whitespacesAndNewlines), !override.isEmpty {
			return TobyPaths(root: URL(fileURLWithPath: (override as NSString).expandingTildeInPath))
		}
		if let preferred = defaults.string(forKey: tobyDirDefaultsKey)?.trimmingCharacters(in: .whitespacesAndNewlines), !preferred.isEmpty {
			return TobyPaths(root: URL(fileURLWithPath: (preferred as NSString).expandingTildeInPath))
		}
		return TobyPaths(root: FileManager.default.homeDirectoryForCurrentUser.appending(path: ".toby"))
	}

	// MARK: Swift-owned

	public var appDirectory: URL { root.appending(path: "app", directoryHint: .isDirectory) }
	public var database: URL { appDirectory.appending(path: "toby.sqlite") }

	// MARK: Legacy (daemon)

	public var legacyChatDatabase: URL { root.appending(path: "chat.sqlite") }
	public var legacyMemoryDatabase: URL { root.appending(path: "memory.sqlite") }
	public var legacyTodoDeviceDatabase: URL { root.appending(path: "todo-device.sqlite") }
	public var legacyEmailDatabase: URL { root.appending(path: "plugins-data/email/email.sqlite") }
	public var legacyConfig: URL { root.appending(path: "config.json") }
	public var legacyCredentials: URL { root.appending(path: "credentials.json") }

	// MARK: Shared file-based data (kept in place)

	public var projects: URL { root.appending(path: "projects", directoryHint: .isDirectory) }
	public var library: URL { root.appending(path: "library", directoryHint: .isDirectory) }
	public var listenRecordings: URL { root.appending(path: "listen/recordings", directoryHint: .isDirectory) }
	public var skills: URL { root.appending(path: "skills", directoryHint: .isDirectory) }
	public var personaImages: URL { root.appending(path: "persona/images", directoryHint: .isDirectory) }
}
