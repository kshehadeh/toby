import AVFoundation
import Foundation

public enum TranscriptionError: Error, CustomStringConvertible, LocalizedError {
	case runtime(String)

	public var description: String {
		switch self {
		case let .runtime(message):
			return message
		}
	}

	public var errorDescription: String? {
		description
	}
}

struct TranscriptSegment: Codable {
	let text: String
	let timestamp: TimeInterval
	let duration: TimeInterval
	let confidence: Float
	let alternatives: [String]
}

struct TranscriptPayload: Codable {
	let text: String
	let segments: [TranscriptSegment]
	let sourceAudio: String
	let createdAt: String
	let locale: String
}

struct WhisperJsonSegment: Decodable {
	let start: TimeInterval?
	let end: TimeInterval?
	let text: String?
}

struct WhisperJsonPayload: Decodable {
	let text: String?
	let transcription: [WhisperJsonSegment]?
	let segments: [WhisperJsonSegment]?
}

public struct TranscriptionOutput {
	public let transcriptPath: String
	public let transcriptJsonPath: String
}

public enum TranscriptionEngine {
	public static func transcribe(
		audioFilePath: String,
		config: ResolvedWhisperConfig
	) async throws -> TranscriptionOutput {
		let inputURL = URL(fileURLWithPath: audioFilePath)
		guard FileManager.default.fileExists(atPath: inputURL.path) else {
			throw TranscriptionError.runtime("Audio file does not exist: \(audioFilePath)")
		}
		guard FileManager.default.fileExists(atPath: config.modelPath) else {
			throw TranscriptionError.runtime(
				"Whisper model not found at \(config.modelPath). Run `toby plugins setup whisper`."
			)
		}

		let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(
			"TobyTranscription-\(UUID().uuidString)",
			isDirectory: true
		)
		try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)

		let whisperInputURL = tempDir.appendingPathComponent("whisper-input.wav")
		try await exportWhisperCompatibleWav(from: inputURL, to: whisperInputURL)

		let whisperPayload = try WhisperInference.transcribeWav(
			modelPath: config.modelPath,
			wavPath: whisperInputURL.path,
			language: config.language
		)
		let payload = transcriptPayload(from: whisperPayload, sourceAudio: inputURL)

		let textURL = tempDir.appendingPathComponent("transcript.txt")
		let jsonURL = tempDir.appendingPathComponent("transcript.json")
		let encoder = JSONEncoder()
		encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
		let jsonData = try encoder.encode(payload)
		guard let textData = payload.text.appending("\n").data(using: .utf8) else {
			throw TranscriptionError.runtime("Could not encode transcript text")
		}
		try atomicWriteData(textData, to: textURL)
		try atomicWriteData(jsonData, to: jsonURL)

		return TranscriptionOutput(
			transcriptPath: textURL.path,
			transcriptJsonPath: jsonURL.path
		)
	}

	private static func isoTimestamp() -> String {
		let formatter = ISO8601DateFormatter()
		formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
		return formatter.string(from: Date())
	}

	private static func isWhisperCompatibleWav(inputURL: URL, format: AVAudioFormat) -> Bool {
		inputURL.pathExtension.lowercased() == "wav"
			&& format.sampleRate == 16_000
			&& format.channelCount == 1
			&& format.commonFormat == .pcmFormatInt16
	}

	private static func exportWhisperCompatibleWav(from inputURL: URL, to outputURL: URL) async throws {
		if FileManager.default.fileExists(atPath: outputURL.path) {
			try FileManager.default.removeItem(at: outputURL)
		}

		let inputFile = try AVAudioFile(forReading: inputURL)
		let inputFormat = inputFile.processingFormat

		if isWhisperCompatibleWav(inputURL: inputURL, format: inputFormat) {
			try FileManager.default.copyItem(at: inputURL, to: outputURL)
			return
		}

		try await runAfconvert(
			inputURL: inputURL,
			outputURL: outputURL
		)
	}

	private static func runAfconvert(inputURL: URL, outputURL: URL) async throws {
		let afconvert = URL(fileURLWithPath: "/usr/bin/afconvert")
		guard FileManager.default.isExecutableFile(atPath: afconvert.path) else {
			throw TranscriptionError.runtime("macOS afconvert helper is not available")
		}

		try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
			let process = Process()
			process.executableURL = afconvert
			process.arguments = [
				"-f", "WAVE",
				"-d", "LEI16@16000",
				"-c", "1",
				inputURL.path,
				outputURL.path,
			]
			process.terminationHandler = { finished in
				if finished.terminationStatus == 0 {
					continuation.resume()
				} else {
					continuation.resume(
						throwing: TranscriptionError.runtime(
							"Could not convert audio for transcription (afconvert exit \(finished.terminationStatus))"
						)
					)
				}
			}
			do {
				try process.run()
			} catch {
				continuation.resume(
					throwing: TranscriptionError.runtime(
						"Could not run afconvert: \(error.localizedDescription)"
					)
				)
			}
		}
	}

	private static func transcriptPayload(from whisper: WhisperJsonPayload, sourceAudio: URL) -> TranscriptPayload {
		let segmentSource = whisper.transcription ?? whisper.segments ?? []
		let segments = segmentSource.map { segment in
			let start = segment.start ?? 0
			let end = segment.end ?? start
			return TranscriptSegment(
				text: (segment.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
				timestamp: start,
				duration: max(0, end - start),
				confidence: 0,
				alternatives: []
			)
		}
		let text =
			whisper.text?.trimmingCharacters(in: .whitespacesAndNewlines)
			?? segments.map(\.text).filter { !$0.isEmpty }.joined(separator: " ")
		return TranscriptPayload(
			text: text,
			segments: segments,
			sourceAudio: sourceAudio.path,
			createdAt: isoTimestamp(),
			locale: Locale.current.identifier
		)
	}

	private static func atomicWriteData(_ data: Data, to url: URL) throws {
		let tempURL = url.deletingLastPathComponent()
			.appendingPathComponent(".\(url.lastPathComponent).tmp-\(UUID().uuidString)")
		try data.write(to: tempURL, options: .atomic)
		if FileManager.default.fileExists(atPath: url.path) {
			try FileManager.default.removeItem(at: url)
		}
		try FileManager.default.moveItem(at: tempURL, to: url)
	}
}
