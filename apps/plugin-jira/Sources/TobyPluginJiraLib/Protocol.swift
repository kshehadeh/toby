import Foundation

public enum PluginConstants {
	public static let name = "jira"
	public static let displayName = "Jira"
	public static let description = "Atlassian Jira issue tracking"
	public static let version = "1.0.0"
	public static let protocolVersion = "1"
}

public struct ConfigEnvelope {
	public let config: [String: Any]
	public let state: [String: Any]
	public let validateTools: Bool

	public static func parse(_ raw: String) -> ConfigEnvelope {
		let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !trimmed.isEmpty,
			let data = trimmed.data(using: .utf8),
			let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
		else {
			return ConfigEnvelope(config: [:], state: [:], validateTools: false)
		}

		let config = parsed["config"] as? [String: Any] ?? [:]
		let state = parsed["state"] as? [String: Any] ?? [:]
		let validateTools = parsed["validateTools"] as? Bool ?? false
		return ConfigEnvelope(config: config, state: state, validateTools: validateTools)
	}
}

public enum PluginOutput {
	public static func emit(_ payload: [String: Any], exitCode: Int32 = 0) -> Never {
		guard JSONSerialization.isValidJSONObject(payload),
			let data = try? JSONSerialization.data(withJSONObject: payload),
			let line = String(data: data, encoding: .utf8)
		else {
			fatalError("Invalid JSON payload")
		}
		print(line)
		fflush(stdout)
		exit(exitCode)
	}

	public static func emitError(_ message: String, code: String = "error", exitCode: Int32 = 1) -> Never {
		emit(["ok": false, "error": message, "code": code], exitCode: exitCode)
	}

	public static func readStdin() -> String {
		var data = Data()
		while true {
			let chunk = FileHandle.standardInput.readData(ofLength: 4096)
			if chunk.isEmpty { break }
			data.append(chunk)
		}
		return String(data: data, encoding: .utf8) ?? ""
	}

	public static func isConnected(config: [String: Any], state: [String: Any]) -> Bool {
		if let connectedAt = state["connectedAt"] as? String, !connectedAt.isEmpty {
			return true
		}
		return JiraClient.hasCredentials(config: config)
	}
}
