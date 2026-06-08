import Foundation

public struct ResolvedWhisperConfig: Sendable {
	public let modelPath: String
	public let language: String

	public var isReady: Bool {
		FileManager.default.fileExists(atPath: modelPath)
	}
}

public enum WhisperConfig {
	public static let defaultModelFile = "ggml-base.en.bin"
	public static let defaultModelBytes: Int64 = 147_951_465
	public static let defaultModelURL =
		"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/\(defaultModelFile)"

	public static func resolve(config: [String: Any]) -> ResolvedWhisperConfig {
		let modelPath =
			stringValue(config["modelPath"])
			?? ProcessInfo.processInfo.environment["TOBY_WHISPER_CPP_MODEL"]
			?? defaultModelPath()
		let language =
			stringValue(config["language"])
			?? ProcessInfo.processInfo.environment["TOBY_WHISPER_CPP_LANGUAGE"]
			?? "auto"
		return ResolvedWhisperConfig(
			modelPath: expandHome(modelPath),
			language: language
		)
	}

	public static func defaultModelPath() -> String {
		expandHome("~/.toby/models/\(defaultModelFile)")
	}

	private static func stringValue(_ value: Any?) -> String? {
		guard let string = value as? String else { return nil }
		let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
		return trimmed.isEmpty ? nil : trimmed
	}

	private static func expandHome(_ path: String) -> String {
		if path.hasPrefix("~/") {
			return NSString(string: path).expandingTildeInPath
		}
		return path
	}
}
