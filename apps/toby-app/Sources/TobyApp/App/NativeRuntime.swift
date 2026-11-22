import Foundation
import TobyAI
import TobyStore

/// Migration switch between the TypeScript daemon and the native Swift core.
///
/// Off by default while the native services are being built. Turn it on
/// against a *copied* Toby home (`TOBY_DIR=/tmp/toby-copy TOBY_NATIVE=1`) to
/// exercise the native path; the M7 cutover enables it for everyone.
enum NativeMode {
	static let defaultsKey = "toby.native.enabled"

	static var isEnabled: Bool {
		if let env = ProcessInfo.processInfo.environment["TOBY_NATIVE"] {
			return env == "1" || env.lowercased() == "true"
		}
		return UserDefaults.standard.bool(forKey: defaultsKey)
	}
}

/// Owns the Swift-side store and AI client for native mode.
@MainActor
final class NativeRuntime {
	static let shared = NativeRuntime()

	private(set) var paths = TobyPaths.current()
	private var database: TobyDatabase?
	private(set) var lastImport: LegacyImporter.Report?

	/// The OpenRouter client, keyed from the Keychain.
	let ai = OpenRouterClient(keyProvider: KeychainKeyStore())

	/// Open the native database, importing the legacy home on first use.
	func store() throws -> TobyDatabase {
		let current = TobyPaths.current()
		if let database, current == paths { return database }
		paths = current
		let opened = try TobyDatabase.open(paths: current)
		let importer = LegacyImporter(paths: current, database: opened)
		if try !importer.hasImported() {
			lastImport = try importer.run()
		}
		database = opened
		return opened
	}
}
