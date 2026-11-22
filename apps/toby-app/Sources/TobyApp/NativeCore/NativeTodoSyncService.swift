import Foundation
import TobyAI
import TobyCore

/// iCloud Drive batch store backed by the in-process `NativeTodoSyncHandler`
/// (coordinated reads/writes, dataless-placeholder downloads).
struct ICloudTodoBatchStore: TodoBatchStore {
	let rootDirectory: String

	private func call(_ action: String, _ body: [String: String] = [:]) async throws -> JSONValue {
		let request = try JSONSerialization.data(withJSONObject: body)
		let data = await MainActor.run { NativeTodoSyncHandler.handle(action, body: request) }
		let response = try JSONDecoder().decode(JSONValue.self, from: data)
		guard response["ok"] == true else {
			throw TodoError("sync_failed", response["error"]?.stringValue ?? "iCloud todo sync failed.")
		}
		return response["data"] ?? .null
	}

	func list() async throws -> [String] {
		try await call("list")["files"]?.arrayValue?.compactMap(\.stringValue) ?? []
	}

	func read(_ name: String) async throws -> String {
		guard let contents = try await call("read", ["name": name])["contents"]?.stringValue else {
			throw TodoError("sync_failed", "Could not download the iCloud todo batch.")
		}
		return contents
	}

	func write(_ name: String, contents: String) async throws {
		_ = try await call("write", ["name": name, "contents": contents])
	}
}

/// Native todo sync: settings + passphrase from Sync & Backup, pull/push via
/// `TodoSync`, and a background loop with 5s→60s backoff (as the daemon did).
final class NativeTodoSyncService: NativeTodoSyncing, @unchecked Sendable {
	let sync: TodoSync
	let tobyDirectory: URL
	private let lock = NSLock()
	private var inFlight: Task<JSONValue, Error>?

	init(service: TodoService, tobyDirectory: URL) {
		sync = TodoSync(service: service)
		self.tobyDirectory = tobyDirectory
	}

	func status() async throws -> JSONValue {
		try sync.status()
	}

	func syncNow() async throws -> JSONValue {
		let result: JSONValue
		do {
			result = try await tick()
		} catch {
			var status = try sync.status().objectValue ?? [:]
			status["error"] = .string(error.localizedDescription)
			return .object(status)
		}
		var status = try sync.status().objectValue ?? [:]
		status["result"] = result
		return .object(status)
	}

	func reconcile() async throws -> JSONValue {
		try sync.reconcileRestored()
		return try sync.status()
	}

	/// One exchange; concurrent callers share the in-flight run.
	func tick() async throws -> JSONValue {
		let task: Task<JSONValue, Error> = lock.withLock {
			if let inFlight { return inFlight }
			let task = Task { try await self.runTick() }
			inFlight = task
			return task
		}
		defer { lock.withLock { inFlight = nil } }
		return try await task.value
	}

	private func runTick() async throws -> JSONValue {
		let settings = TodoSyncSettings.read(tobyDirectory: tobyDirectory)
		guard settings.enabled, !sync.service.needsRestoreReview else { return ["paused": true] }
		do {
			let store = try await batchStore(for: settings)
			guard let password = TodoSyncSettings.passphrase(tobyDirectory: tobyDirectory) else {
				throw TodoError("sync_locked", "Unlock Sync and Backup with the sync password to sync todos.")
			}
			let directory = tobyDirectory
			let result = try await sync.exchange(store: store, password: password) {
				TodoSyncSettings.read(tobyDirectory: directory) == settings
			}
			sync.record(success: true, error: nil)
			return result.json
		} catch {
			sync.record(success: false, error: error.localizedDescription)
			throw error
		}
	}

	private func batchStore(for settings: TodoSyncSettings) async throws -> any TodoBatchStore {
		let environment = ProcessInfo.processInfo.environment
		let override = environment["TOBY_SYNC_DIR"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		if override.isEmpty, settings.backend == "icloud" {
			let iCloudRoot = await MainActor.run { NativeICloudHandler.resolveRoot().path }
			let root = TodoSyncSettings.resolve(iCloudRoot)
			guard FileManager.default.fileExists(atPath: FileManager.default.homeDirectoryForCurrentUser.path + "/Library/Mobile Documents/com~apple~CloudDocs") else {
				throw TodoError("sync_unavailable", "The todo sync destination is unavailable. Reconnect it in Sync and Backup.")
			}
			return ICloudTodoBatchStore(rootDirectory: root)
		}
		if override.isEmpty {
			var isDirectory: ObjCBool = false
			let picked = settings.folderPath?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
			guard !picked.isEmpty, FileManager.default.fileExists(atPath: picked, isDirectory: &isDirectory), isDirectory.boolValue else {
				throw TodoError("sync_unavailable", "The todo sync destination is unavailable. Reconnect it in Sync and Backup.")
			}
		}
		return FileTodoBatchStore(rootDirectory: settings.vaultRoot(environment: environment))
	}

	/// Background loop (native mode only).
	func runLoop() async {
		var retry: Duration = .seconds(5)
		while !Task.isCancelled {
			do {
				_ = try await tick()
				retry = .seconds(5)
			} catch {
				retry = min(retry * 2, .seconds(60))
			}
			try? await Task.sleep(for: retry)
		}
	}
}
