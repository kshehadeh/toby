import Foundation
import Testing
@testable import TobyApp

/// Serialized: tests mutate process-wide `TOBY_DIR` / `UserDefaults.standard`.
@Suite("ConfigReader", .serialized)
struct ConfigReaderTests {
	@Test("defaultTobyDir ends with .toby under the user home")
	func defaultTobyDirShape() {
		let path = ConfigReader.defaultTobyDir()
		#expect(path.hasSuffix("/.toby") || path.hasSuffix(".toby"))
		#expect(ConfigReader.standardizePath(path) == path)
	}

	@Test("standardizePath resolves relative segments")
	func standardizePath() {
		let home = FileManager.default.homeDirectoryForCurrentUser.path
		let raw = home + "/.toby/../.toby"
		let standardized = ConfigReader.standardizePath(raw)
		#expect(standardized == ConfigReader.standardizePath(home + "/.toby"))
	}

	@Test("resolveTobyDir prefers UserDefaults when TOBY_DIR is unset")
	func resolvePrefersUserDefaults() {
		let previousEnv = ProcessInfo.processInfo.environment["TOBY_DIR"]
		let previousDefaults = UserDefaults.standard.string(forKey: ConfigReader.tobyDirDefaultsKey)
		defer {
			if let previousEnv {
				setenv("TOBY_DIR", previousEnv, 1)
			} else {
				unsetenv("TOBY_DIR")
			}
			if let previousDefaults {
				UserDefaults.standard.set(previousDefaults, forKey: ConfigReader.tobyDirDefaultsKey)
			} else {
				UserDefaults.standard.removeObject(forKey: ConfigReader.tobyDirDefaultsKey)
			}
		}

		unsetenv("TOBY_DIR")
		let custom = FileManager.default.temporaryDirectory
			.appendingPathComponent("toby-home-\(UUID().uuidString)", isDirectory: true)
			.path
		UserDefaults.standard.set(custom, forKey: ConfigReader.tobyDirDefaultsKey)
		#expect(ConfigReader.resolveTobyDir() == ConfigReader.standardizePath(custom))
		#expect(ConfigReader.isCustomTobyDir())
	}

	@Test("resolveTobyDir prefers environment over UserDefaults")
	func resolvePrefersEnvironment() {
		let previousEnv = ProcessInfo.processInfo.environment["TOBY_DIR"]
		let previousDefaults = UserDefaults.standard.string(forKey: ConfigReader.tobyDirDefaultsKey)
		defer {
			if let previousEnv {
				setenv("TOBY_DIR", previousEnv, 1)
			} else {
				unsetenv("TOBY_DIR")
			}
			if let previousDefaults {
				UserDefaults.standard.set(previousDefaults, forKey: ConfigReader.tobyDirDefaultsKey)
			} else {
				UserDefaults.standard.removeObject(forKey: ConfigReader.tobyDirDefaultsKey)
			}
		}

		let envPath = FileManager.default.temporaryDirectory
			.appendingPathComponent("toby-env-\(UUID().uuidString)", isDirectory: true)
			.path
		let defaultsPath = FileManager.default.temporaryDirectory
			.appendingPathComponent("toby-defaults-\(UUID().uuidString)", isDirectory: true)
			.path
		setenv("TOBY_DIR", envPath, 1)
		UserDefaults.standard.set(defaultsPath, forKey: ConfigReader.tobyDirDefaultsKey)
		#expect(ConfigReader.resolveTobyDir() == ConfigReader.standardizePath(envPath))
	}

	@Test("generatedFilesDir is under the resolved Toby dir")
	func generatedFilesDir() {
		let dir = ConfigReader.generatedFilesDir()
		#expect(dir.hasSuffix("/generated-files"))
		#expect(dir.hasPrefix(ConfigReader.resolveTobyDir()))
	}

	@Test("ensureWritableDirectory creates missing folders")
	func ensureWritableCreates() throws {
		let dir = FileManager.default.temporaryDirectory
			.appendingPathComponent("toby-writable-\(UUID().uuidString)", isDirectory: true)
			.path
		try ConfigReader.ensureWritableDirectory(at: dir)
		var isDir: ObjCBool = false
		#expect(FileManager.default.fileExists(atPath: dir, isDirectory: &isDir))
		#expect(isDir.boolValue)
		try? FileManager.default.removeItem(atPath: dir)
	}
}
