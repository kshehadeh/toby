import Darwin
import Foundation
import TobyAI
import TobyCore
import TobyStore

/// One-time upgrade from the TypeScript daemon era: stop a daemon still
/// running for this home, then remove what it left behind (plugins, their
/// data, the bundled Bun helper, lock and port files). Runs only after the
/// legacy import has succeeded, since the mail import reads `plugins-data`.
enum LegacyDaemonCleanup {
	static let marker = "legacy-cleanup-done"
	static let leftovers = ["plugins", "plugins-data", "helpers/bun", "daemon.lock", "native-port", "staging"]

	static func runOnce(_ paths: TobyPaths, imported: Bool) {
		let fm = FileManager.default
		let markerURL = paths.appDirectory.appending(path: marker)
		guard imported, !fm.fileExists(atPath: markerURL.path) else { return }
		stopDaemon(lockFile: paths.root.appending(path: "daemon.lock"))
		var removed: [JSONValue] = []
		for name in leftovers {
			let url = paths.root.appending(path: name)
			guard fm.fileExists(atPath: url.path) else { continue }
			do { try fm.removeItem(at: url); removed.append(.string(name)) } catch {
				TobyLog.shared.warn("upgrade", "legacy_cleanup_failed", ["path": .string(name), "error": .string(error.localizedDescription)])
			}
		}
		fm.createFile(atPath: markerURL.path, contents: Data(ISO8601DateFormatter().string(from: Date()).utf8))
		TobyLog.shared.info("upgrade", "legacy_cleanup_complete", ["removed": .array(removed)])
	}

	/// SIGTERM the pid in `daemon.lock` when it is a `toby … daemon run` process,
	/// waiting up to five seconds before SIGKILL.
	static func stopDaemon(lockFile: URL) {
		guard let data = try? Data(contentsOf: lockFile),
		      let pid = (try? JSONDecoder().decode(JSONValue.self, from: data))?["pid"]?.intValue, pid > 1,
		      kill(pid_t(pid), 0) == 0, isTobyDaemon(pid) else { return }
		kill(pid_t(pid), SIGTERM)
		let deadline = Date().addingTimeInterval(5)
		while Date() < deadline, kill(pid_t(pid), 0) == 0 { usleep(100_000) }
		if kill(pid_t(pid), 0) == 0 { kill(pid_t(pid), SIGKILL) }
		TobyLog.shared.info("upgrade", "legacy_daemon_stopped", ["pid": .number(Double(pid))])
	}

	static func isTobyDaemon(_ pid: Int) -> Bool {
		guard pid != Int(getpid()) else { return false }
		let process = Process()
		process.executableURL = URL(fileURLWithPath: "/bin/ps")
		process.arguments = ["-p", String(pid), "-o", "command="]
		let pipe = Pipe()
		process.standardOutput = pipe
		process.standardError = FileHandle.nullDevice
		guard (try? process.run()) != nil else { return false }
		process.waitUntilExit()
		let command = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self).lowercased()
		return isDaemonCommand(command)
	}

	/// `…/toby daemon run …` (bundled CLI) or `bun …/cli.ts daemon run …` (dev).
	static func isDaemonCommand(_ command: String) -> Bool {
		let text = command.lowercased()
		return text.contains(" daemon run") && (text.contains("/toby ") || text.contains("toby/apps/cli") || text.contains("cli.ts"))
	}
}
