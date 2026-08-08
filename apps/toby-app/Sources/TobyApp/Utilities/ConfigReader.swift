import Foundation

enum ConfigReader {
	/// UserDefaults key for the app-local Toby data directory override
	/// (Settings → General). Same string as `AppearanceDefaultsKey.tobyDir`.
	static let tobyDirDefaultsKey = "toby.general.tobyDir"

	/// Default data root: `~/.toby`.
	static func defaultTobyDir() -> String {
		standardizePath(
			FileManager.default.homeDirectoryForCurrentUser
				.appendingPathComponent(".toby").path
		)
	}

	/// Resolves the Toby data directory.
	///
	/// Precedence:
	/// 1. `TOBY_DIR` environment variable (dev / CLI / mid-session setenv)
	/// 2. UserDefaults `toby.general.tobyDir` (Settings → General)
	/// 3. Default `~/.toby`
	static func resolveTobyDir() -> String {
		if let override = ProcessInfo.processInfo.environment["TOBY_DIR"]?
			.trimmingCharacters(in: .whitespacesAndNewlines), !override.isEmpty
		{
			return standardizePath(override)
		}
		if let preferred = UserDefaults.standard.string(forKey: tobyDirDefaultsKey)?
			.trimmingCharacters(in: .whitespacesAndNewlines), !preferred.isEmpty
		{
			return standardizePath(preferred)
		}
		return defaultTobyDir()
	}

	/// Whether the resolved home differs from the default `~/.toby`.
	static func isCustomTobyDir() -> Bool {
		standardizePath(resolveTobyDir()) != defaultTobyDir()
	}

	/// Absolute, symlink-resolved path for equality checks.
	static func standardizePath(_ path: String) -> String {
		URL(fileURLWithPath: path)
			.standardizedFileURL
			.resolvingSymlinksInPath()
			.path
	}

	/// Syncs `TOBY_DIR` in the process environment from the UserDefaults preference
	/// (or clears it when the preference is empty so default resolution applies).
	static func syncTobyDirEnvironment(
		defaults: UserDefaults = .standard
	) {
		if let preferred = defaults.string(forKey: tobyDirDefaultsKey)?
			.trimmingCharacters(in: .whitespacesAndNewlines), !preferred.isEmpty
		{
			setenv("TOBY_DIR", standardizePath(preferred), 1)
		} else {
			unsetenv("TOBY_DIR")
		}
	}

	/// Ensures `path` exists as a writable directory. Creates intermediate
	/// directories when missing. Throws on failure.
	static func ensureWritableDirectory(at path: String) throws {
		let fm = FileManager.default
		var isDir: ObjCBool = false
		if fm.fileExists(atPath: path, isDirectory: &isDir) {
			guard isDir.boolValue else {
				throw TobyHomeError.notADirectory(path)
			}
		} else {
			try fm.createDirectory(atPath: path, withIntermediateDirectories: true)
		}
		// Probe write access without leaving debris when possible.
		let probe = (path as NSString).appendingPathComponent(".toby-write-probe-\(UUID().uuidString)")
		guard fm.createFile(atPath: probe, contents: Data(), attributes: nil) else {
			throw TobyHomeError.notWritable(path)
		}
		try? fm.removeItem(atPath: probe)
	}

	static func resolveDaemonPort() -> Int {
		let configURL = URL(fileURLWithPath: resolveTobyDir())
			.appendingPathComponent("config.json")
		guard
			let data = try? Data(contentsOf: configURL),
			let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
			let web = json["web"] as? [String: Any],
			let port = web["port"] as? Int
		else {
			return 7847
		}
		return port
	}

	static func baseURL() -> URL {
		URL(string: "http://127.0.0.1:\(resolveDaemonPort())")!
	}

	/// Preferred capture sources for Record Audio (`config.listen`).
	/// Defaults to both microphone and system audio when unset.
	static func listenRecordSources() -> (mic: Bool, system: Bool) {
		let configURL = URL(fileURLWithPath: resolveTobyDir())
			.appendingPathComponent("config.json")
		guard
			let data = try? Data(contentsOf: configURL),
			let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
			let listen = json["listen"] as? [String: Any]
		else {
			return (mic: true, system: true)
		}
		let mic = listen["recordMic"] as? Bool ?? true
		let system = listen["recordSystem"] as? Bool ?? true
		if !mic && !system {
			return (mic: true, system: true)
		}
		return (mic: mic, system: system)
	}
}

enum TobyHomeError: LocalizedError {
	case notADirectory(String)
	case notWritable(String)
	case busy(String)
	case alreadyCurrent
	case invalidPath

	var errorDescription: String? {
		switch self {
		case .notADirectory(let path):
			return "The path is not a directory: \(path)"
		case .notWritable(let path):
			return "Toby cannot write to this directory: \(path)"
		case .busy(let reason):
			return reason
		case .alreadyCurrent:
			return "That folder is already Toby’s home directory."
		case .invalidPath:
			return "Choose a valid folder path."
		}
	}
}
