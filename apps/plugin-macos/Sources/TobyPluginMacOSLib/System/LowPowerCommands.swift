import Foundation

enum LowPowerCommands {
	static func statusData() throws -> [String: Any] {
		let process = Process()
		process.executableURL = URL(fileURLWithPath: "/usr/bin/pmset")
		process.arguments = ["-g", "custom"]
		let pipe = Pipe()
		process.standardOutput = pipe
		process.standardError = FileHandle.nullDevice
		try process.run()
		process.waitUntilExit()

		guard process.terminationStatus == 0 else {
			throw HelperError.runtime("pmset -g custom failed")
		}
		let outputData = pipe.fileHandleForReading.readDataToEndOfFile()
		guard let output = String(data: outputData, encoding: .utf8) else {
			throw HelperError.runtime("Could not read pmset output")
		}

		var lowPowerMode: String?
		for line in output.split(separator: "\n") {
			let trimmed = line.trimmingCharacters(in: .whitespaces)
			if trimmed.hasPrefix("lowpowermode") {
				let parts = trimmed.split(separator: /\s+/, maxSplits: 1)
				if parts.count >= 2 {
					lowPowerMode = String(parts[1])
				}
			}
		}

		var result: [String: Any] = [:]
		if let lpm = lowPowerMode {
			result["lowPowerMode"] = lpm
			result["enabled"] = lpm == "1"
		} else {
			result["lowPowerMode"] = "not reported"
			result["enabled"] = false
		}
		return result
	}

	static func setEnabled(_ enabled: Bool) throws -> [String: Any] {
		let value = enabled ? "1" : "0"
		let process = Process()
		process.executableURL = URL(fileURLWithPath: "/usr/bin/pmset")
		process.arguments = ["-a", "lowpowermode", value]
		let errPipe = Pipe()
		process.standardOutput = FileHandle.nullDevice
		process.standardError = errPipe
		try process.run()
		process.waitUntilExit()

		if process.terminationStatus != 0 {
			let errData = errPipe.fileHandleForReading.readDataToEndOfFile()
			let errMsg = String(data: errData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "unknown error"
			throw HelperError.runtime("pmset lowpowermode failed: \(errMsg). May require admin privileges — use a Shortcut or run manually with sudo.")
		}

		return ["lowPowerMode": value, "enabled": enabled]
	}
}
