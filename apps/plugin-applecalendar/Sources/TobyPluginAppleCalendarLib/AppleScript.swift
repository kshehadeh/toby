import Foundation

public struct AppleScriptResult {
	public let success: Bool
	public let output: String
	public let error: String?
}

public enum AppleScriptRunner {
	public static func execute(_ script: String, timeoutMs: Int = 30_000) -> AppleScriptResult {
		let process = Process()
		process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
		process.arguments = ["-e", script]

		let outputPipe = Pipe()
		let errorPipe = Pipe()
		process.standardOutput = outputPipe
		process.standardError = errorPipe

		do {
			try process.run()
		} catch {
			return AppleScriptResult(success: false, output: "", error: error.localizedDescription)
		}

		let group = DispatchGroup()
		group.enter()
		DispatchQueue.global().async {
			process.waitUntilExit()
			group.leave()
		}
		let timedOut = group.wait(timeout: .now() + .milliseconds(timeoutMs)) == .timedOut
		if timedOut {
			process.terminate()
			return AppleScriptResult(success: false, output: "", error: "AppleScript timed out after \(timeoutMs)ms")
		}

		let outputData = outputPipe.fileHandleForReading.readDataToEndOfFile()
		let errorData = errorPipe.fileHandleForReading.readDataToEndOfFile()
		let output = String(data: outputData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		let stderr = String(data: errorData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

		if process.terminationStatus != 0 {
			return AppleScriptResult(
				success: false,
				output: output,
				error: stderr.isEmpty ? "AppleScript exited with status \(process.terminationStatus)" : stderr
			)
		}
		return AppleScriptResult(success: true, output: output, error: nil)
	}

	public static func escapeForAppleScript(_ value: String) -> String {
		value
			.replacingOccurrences(of: "\\", with: "\\\\")
			.replacingOccurrences(of: "\"", with: "\\\"")
	}
}
