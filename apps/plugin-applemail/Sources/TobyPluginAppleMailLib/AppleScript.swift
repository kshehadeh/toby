import Foundation

struct AppleScriptResult {
	let success: Bool
	let output: String
	let error: String?
}

public enum AppleScriptRunner {
	private static let defaultTimeoutMs = 30_000
	private static let defaultMaxRetries = 1
	private static let defaultRetryDelayMs = 1_000

	public static func escapeForAppleScript(_ text: String) -> String {
		guard !text.isEmpty else { return "" }
		return text
			.replacingOccurrences(of: "\\", with: "\\\\")
			.replacingOccurrences(of: "\"", with: "\\\"")
	}

	public static func parseAppleScriptDate(_ dateStr: String) -> Date {
		let numParts = dateStr.split(separator: "-").compactMap { Int($0) }
		if numParts.count == 6 {
			let y = numParts[0]
			let mo = numParts[1]
			let d = numParts[2]
			let h = numParts[3]
			let mi = numParts[4]
			let s = numParts[5]
			var components = DateComponents()
			components.year = y
			components.month = mo
			components.day = d
			components.hour = h
			components.minute = mi
			components.second = s
			return Calendar.current.date(from: components) ?? Date()
		}

		var normalized = dateStr
		if normalized.hasPrefix("date ") {
			normalized = String(normalized.dropFirst(5))
		}
		normalized = normalized.replacingOccurrences(of: " at ", with: " ")
		let formatter = DateFormatter()
		formatter.locale = Locale(identifier: "en_US_POSIX")
		for format in [
			"EEEE, MMMM d, yyyy 'at' h:mm:ss a",
			"MMMM d, yyyy h:mm:ss a",
			"MMMM d, yyyy",
		] {
			formatter.dateFormat = format
			if let date = formatter.date(from: normalized) {
				return date
			}
		}
		return Date()
	}

	static func execute(
		_ script: String,
		timeoutMs: Int = defaultTimeoutMs,
		maxRetries: Int = defaultMaxRetries,
		retryDelayMs: Int = defaultRetryDelayMs
	) -> AppleScriptResult {
		#if !os(macOS)
		return AppleScriptResult(success: false, output: "", error: "AppleScript is only available on macOS.")
		#else
		let trimmed = script.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty else {
			return AppleScriptResult(success: false, output: "", error: "Cannot execute empty AppleScript")
		}

		var lastError: AppleScriptResult?
		for attempt in 1 ... maxRetries {
			let result = runOnce(trimmed, timeoutMs: timeoutMs)
			if result.success {
				return result
			}
			lastError = result
			let canRetry = isRetryable(result.error ?? "")
			if canRetry && attempt < maxRetries {
				let delayMs = retryDelayMs * (1 << (attempt - 1))
				Thread.sleep(forTimeInterval: Double(delayMs) / 1000.0)
			} else {
				return result
			}
		}
		return lastError ?? AppleScriptResult(success: false, output: "", error: "AppleScript failed after retries.")
		#endif
	}

	#if os(macOS)
	private static func runOnce(_ script: String, timeoutMs: Int) -> AppleScriptResult {
		let process = Process()
		process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
		process.arguments = ["-e", script]

		let stdoutPipe = Pipe()
		let stderrPipe = Pipe()
		process.standardOutput = stdoutPipe
		process.standardError = stderrPipe

		do {
			try process.run()
		} catch {
			return AppleScriptResult(success: false, output: "", error: error.localizedDescription)
		}

		let group = DispatchGroup()
		group.enter()
		final class TimeoutFlag { var value = false }
		let timedOutFlag = TimeoutFlag()
		DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(timeoutMs)) {
			if process.isRunning {
				timedOutFlag.value = true
				process.terminate()
			}
			group.leave()
		}

		process.waitUntilExit()
		group.wait()

		let stdoutData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
		let stderrData = stderrPipe.fileHandleForReading.readDataToEndOfFile()
		let stdout = String(data: stdoutData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
		let stderr = String(data: stderrData, encoding: .utf8) ?? ""

		if timedOutFlag.value {
			let secs = Int(round(Double(timeoutMs) / 1000.0))
			return AppleScriptResult(success: false, output: "", error: "Operation timed out after \(secs) seconds.")
		}

		if process.terminationStatus == 0 {
			return AppleScriptResult(success: true, output: stdout, error: nil)
		}

		let message = parseErrorMessage(stderr.isEmpty ? stdout : stderr)
		return AppleScriptResult(success: false, output: "", error: message)
	}
	#endif

	private static func isRetryable(_ message: String) -> Bool {
		let patterns = [
			"timed? out",
			"not responding",
			"connection.*invalid",
			"lost connection",
			"busy",
		]
		for pattern in patterns {
			if message.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil {
				return true
			}
		}
		return false
	}

	private static func parseErrorMessage(_ errorOutput: String) -> String {
		var coreError = errorOutput
		if let match = errorOutput.range(
			of: #"execution error: (.+?)(?:\s*\(-?\d+\))?$"#,
			options: [.regularExpression]
		) {
			let snippet = String(errorOutput[match])
			if let colon = snippet.firstIndex(of: ":") {
				coreError = String(snippet[snippet.index(after: colon)...]).trimmingCharacters(in: .whitespacesAndNewlines)
			}
		}

		if coreError.range(of: #"not authorized|not permitted|access.*denied"#, options: .regularExpression) != nil {
			return "Automation permission denied. Grant Terminal/Cursor access to Mail in System Settings → Privacy & Security → Automation."
		}
		if coreError.range(of: #"application isn't running|not running"#, options: .regularExpression) != nil {
			return "Mail.app is not running or not responding."
		}
		if coreError.range(of: #"connection is invalid|lost connection"#, options: .regularExpression) != nil {
			return "Lost connection to Mail.app."
		}
		if let match = coreError.range(of: #"Can't get (.+?)\."#, options: .regularExpression) {
			let snippet = String(coreError[match])
			return "Not found: \(snippet)"
		}
		let trimmed = coreError.trimmingCharacters(in: .whitespacesAndNewlines)
		return trimmed.isEmpty ? "Unknown AppleScript error" : trimmed
	}
}
