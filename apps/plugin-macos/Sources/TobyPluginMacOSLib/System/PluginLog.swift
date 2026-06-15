import ApplicationServices
import Darwin
import Foundation

public enum PluginLog {
	public static let category = "plugin-macos"

	private static let maxBytes = 512 * 1024
	private static let keepRatio = 0.6
	private static let queue = DispatchQueue(label: "dev.karim.toby.plugin-macos.log")

	private static func makeIsoFormatter() -> ISO8601DateFormatter {
		let f = ISO8601DateFormatter()
		f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		return f
	}

	public static func info(_ type: String, data: [String: Any]? = nil) {
		write(level: "info", type: type, data: data)
	}

	public static func warn(_ type: String, data: [String: Any]? = nil) {
		write(level: "warn", type: type, data: data)
	}

	public static func error(_ type: String, data: [String: Any]? = nil) {
		write(level: "error", type: type, data: data)
	}

	public static func debug(_ type: String, data: [String: Any]? = nil) {
		write(level: "debug", type: type, data: data)
	}

	public static func processFingerprint() -> [String: Any] {
		var info: [String: Any] = [
			"pid": Int(getpid()),
			"ppid": Int(getppid()),
			"executable": executablePath(),
			"argv0": CommandLine.arguments.first ?? "",
		]
		if let parent = parentExecutablePath() {
			info["parentExecutable"] = parent
		}
		info["accessibilityTrusted"] = AXIsProcessTrusted()
		return info
	}

	private static func write(level: String, type: String, data: [String: Any]?) {
		let entry: [String: Any] = [
			"ts": makeIsoFormatter().string(from: Date()),
			"level": level,
			"category": category,
			"type": type,
			"data": data ?? [:],
		]
		queue.sync {
			guard JSONSerialization.isValidJSONObject(entry),
				let json = try? JSONSerialization.data(withJSONObject: entry, options: [.sortedKeys]),
				let line = String(data: json, encoding: .utf8)
			else { return }
			append(line: line)
		}
	}

	private static func append(line: String) {
		do {
			let dir = tobyDir()
			try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
			let path = dir.appendingPathComponent("plugin-macos.log")
			let payload = (line + "\n").data(using: .utf8) ?? Data()
			if let handle = try? FileHandle(forWritingTo: path) {
				defer { try? handle.close() }
				try handle.seekToEnd()
				try handle.write(contentsOf: payload)
			} else {
				try payload.write(to: path, options: .atomic)
			}
			rotateIfNeeded(path: path)
		} catch {
			// Logging must never throw or interrupt plugin output.
		}
	}

	private static func rotateIfNeeded(path: URL) {
		guard let attrs = try? FileManager.default.attributesOfItem(atPath: path.path),
			let size = attrs[.size] as? NSNumber,
			size.intValue > maxBytes
		else { return }
		guard let content = try? String(contentsOf: path, encoding: .utf8) else { return }
		let lines = content.split(omittingEmptySubsequences: true, whereSeparator: { $0 == "\n" })
		let keepCount = Int(Double(lines.count) * keepRatio)
		guard keepCount > 0 && keepCount < lines.count else { return }
		let kept = lines.suffix(keepCount).joined(separator: "\n") + "\n"
		try? kept.write(to: path, atomically: true, encoding: .utf8)
	}

	private static func tobyDir() -> URL {
		if let override = ProcessInfo.processInfo.environment["TOBY_DIR"], !override.isEmpty {
			return URL(fileURLWithPath: (override as NSString).expandingTildeInPath, isDirectory: true)
		}
		let home = FileManager.default.homeDirectoryForCurrentUser
		return home.appendingPathComponent(".toby", isDirectory: true)
	}

	private static func executablePath() -> String {
		var size = UInt32(4096)
		var buf = [CChar](repeating: 0, count: Int(size))
		if _NSGetExecutablePath(&buf, &size) == 0 {
			let raw = String(cString: buf)
			let resolved = (raw as NSString).resolvingSymlinksInPath
			return resolved
		}
		return CommandLine.arguments.first ?? ""
	}

	private static func parentExecutablePath() -> String? {
		let ppid = getppid()
		let process = Process()
		process.executableURL = URL(fileURLWithPath: "/bin/ps")
		process.arguments = ["-o", "comm=", "-p", "\(ppid)"]
		let pipe = Pipe()
		process.standardOutput = pipe
		process.standardError = FileHandle.nullDevice
		do {
			try process.run()
			process.waitUntilExit()
			let data = pipe.fileHandleForReading.readDataToEndOfFile()
			let out = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
			return (out?.isEmpty == false) ? out : nil
		} catch {
			return nil
		}
	}
}
