import Foundation

public enum WhisperTools {
	public static var definitions: [[String: Any]] {
		[
		[
			"name": "doTranscription",
			"description":
				"Transcribe an on-disk audio file to temp transcript files (listen harness only).",
			"readOnly": true,
			"inputSchema": [
				"type": "object",
				"properties": [
					"audioFilePath": [
						"type": "string",
						"description": "Absolute path to the audio file to transcribe",
					],
				],
				"required": ["audioFilePath"],
			] as [String: Any],
		],
		]
	}

	public struct ExecutedTool {
		public let result: [String: Any]
		public let appliedActions: [String]
	}

	public enum ExecuteError: Error {
		case message(String)
	}

	public static func execute(
		tool: String,
		input: [String: Any],
		config: [String: Any],
		dryRun: Bool
	) -> Result<ExecutedTool, ExecuteError> {
		guard tool == "doTranscription" else {
			return .failure(.message("Unknown tool: \(tool)"))
		}
		guard let audioFilePath = input["audioFilePath"] as? String,
			!audioFilePath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
		else {
			return .failure(.message("audioFilePath is required"))
		}
		if dryRun {
			return .success(
				ExecutedTool(
					result: [
						"transcriptPath": "/tmp/toby-transcription-dry-run.txt",
						"transcriptJsonPath": "/tmp/toby-transcription-dry-run.json",
					],
					appliedActions: []
				)
			)
		}

		let resolved = WhisperConfig.resolve(config: config)
		final class ResultBox: @unchecked Sendable {
			var value: Result<TranscriptionOutput, Error>?
		}
		let box = ResultBox()
		let semaphore = DispatchSemaphore(value: 0)
		Task {
			do {
				let result = try await TranscriptionEngine.transcribe(
					audioFilePath: audioFilePath,
					config: resolved
				)
				box.value = .success(result)
			} catch {
				box.value = .failure(error)
			}
			semaphore.signal()
		}
		semaphore.wait()

		switch box.value {
		case let .success(result):
			return .success(
				ExecutedTool(
					result: [
						"transcriptPath": result.transcriptPath,
						"transcriptJsonPath": result.transcriptJsonPath,
					],
					appliedActions: []
				)
			)
		case let .failure(error):
			if let transcriptionError = error as? TranscriptionError {
				return .failure(.message(transcriptionError.description))
			}
			return .failure(.message(String(describing: error)))
		case .none:
			return .failure(.message("Transcription did not complete"))
		}
	}
}
