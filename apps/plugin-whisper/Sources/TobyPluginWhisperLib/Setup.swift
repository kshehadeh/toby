import Foundation

public enum WhisperSetup {
	public static func run(config: [String: Any], forceModel: Bool = false) throws -> [String: Any] {
		let modelInstallTarget =
			stringValue(config["modelInstallTarget"]) ?? WhisperConfig.defaultModelPath()

		try FileManager.default.createDirectory(
			atPath: (modelInstallTarget as NSString).deletingLastPathComponent,
			withIntermediateDirectories: true
		)

		if forceModel, FileManager.default.fileExists(atPath: modelInstallTarget) {
			try? FileManager.default.removeItem(atPath: modelInstallTarget)
		}

		if !modelLooksInstalled(at: modelInstallTarget) {
			try downloadModel(to: modelInstallTarget)
		}

		guard FileManager.default.fileExists(atPath: modelInstallTarget) else {
			throw NSError(
				domain: "TobyPluginWhisper",
				code: 1,
				userInfo: [NSLocalizedDescriptionKey: "Whisper model not found at \(modelInstallTarget)"]
			)
		}

		return [
			"modelPath": modelInstallTarget,
			"language": stringValue(config["language"]) ?? "auto",
		]
	}

	private static func modelLooksInstalled(at path: String) -> Bool {
		guard let attributes = try? FileManager.default.attributesOfItem(atPath: path),
			let size = attributes[.size] as? NSNumber
		else {
			return false
		}
		return size.int64Value >= Int64(Double(WhisperConfig.defaultModelBytes) * 0.9)
	}

	private static func downloadModel(to modelPath: String) throws {
		guard let url = URL(string: WhisperConfig.defaultModelURL) else {
			throw NSError(
				domain: "TobyPluginWhisper",
				code: 1,
				userInfo: [NSLocalizedDescriptionKey: "Invalid model download URL"]
			)
		}
		let tempPath = "\(modelPath).download-\(UUID().uuidString)"
		let data = try Data(contentsOf: url)
		if Int64(data.count) < Int64(Double(WhisperConfig.defaultModelBytes) * 0.9) {
			throw NSError(
				domain: "TobyPluginWhisper",
				code: 1,
				userInfo: [NSLocalizedDescriptionKey: "Downloaded model looks too small"]
			)
		}
		try data.write(to: URL(fileURLWithPath: tempPath), options: .atomic)
		if FileManager.default.fileExists(atPath: modelPath) {
			try FileManager.default.removeItem(atPath: modelPath)
		}
		try FileManager.default.moveItem(atPath: tempPath, toPath: modelPath)
	}

	private static func stringValue(_ value: Any?) -> String? {
		guard let string = value as? String else { return nil }
		let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
		return trimmed.isEmpty ? nil : trimmed
	}
}
