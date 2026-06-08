import AVFoundation
import Foundation

public enum TranscriptionError: Error, CustomStringConvertible {
	case runtime(String)

	public var description: String {
		switch self {
		case let .runtime(message):
			return message
		}
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

	private static func whisperOutputSettings() -> [String: Any] {
		[
			AVFormatIDKey: kAudioFormatLinearPCM,
			AVSampleRateKey: 16_000,
			AVNumberOfChannelsKey: 1,
			AVLinearPCMBitDepthKey: 16,
			AVLinearPCMIsFloatKey: false,
			AVLinearPCMIsBigEndianKey: false,
			AVLinearPCMIsNonInterleaved: false,
		]
	}

	private static func exportWhisperCompatibleWav(from inputURL: URL, to outputURL: URL) async throws {
		let asset = AVURLAsset(url: inputURL)
		guard let track = try await asset.loadTracks(withMediaType: .audio).first else {
			throw TranscriptionError.runtime("No audio track found in \(inputURL.lastPathComponent)")
		}

		let reader = try AVAssetReader(asset: asset)
		let outputSettings = whisperOutputSettings()
		let readerOutput = AVAssetReaderTrackOutput(track: track, outputSettings: outputSettings)
		readerOutput.alwaysCopiesSampleData = false
		guard reader.canAdd(readerOutput) else {
			throw TranscriptionError.runtime("Could not configure audio reader")
		}
		reader.add(readerOutput)

		if FileManager.default.fileExists(atPath: outputURL.path) {
			try FileManager.default.removeItem(at: outputURL)
		}
		let writer = try AVAssetWriter(outputURL: outputURL, fileType: .wav)
		let writerInput = AVAssetWriterInput(mediaType: .audio, outputSettings: outputSettings)
		writerInput.expectsMediaDataInRealTime = false
		guard writer.canAdd(writerInput) else {
			throw TranscriptionError.runtime("Could not configure audio writer")
		}
		writer.add(writerInput)

		guard reader.startReading() else {
			throw TranscriptionError.runtime(reader.error?.localizedDescription ?? "Could not start reading audio")
		}
		guard writer.startWriting() else {
			throw TranscriptionError.runtime(writer.error?.localizedDescription ?? "Could not start writing audio")
		}
		writer.startSession(atSourceTime: .zero)

		while reader.status == .reading {
			if writerInput.isReadyForMoreMediaData {
				guard let sampleBuffer = readerOutput.copyNextSampleBuffer() else {
					writerInput.markAsFinished()
					break
				}
				guard writerInput.append(sampleBuffer) else {
					throw TranscriptionError.runtime(writer.error?.localizedDescription ?? "Could not append audio sample")
				}
			}
		}

		await withCheckedContinuation { continuation in
			writer.finishWriting {
				continuation.resume()
			}
		}

		if reader.status == .failed {
			throw TranscriptionError.runtime(reader.error?.localizedDescription ?? "Audio read failed")
		}
		if writer.status != .completed {
			throw TranscriptionError.runtime(writer.error?.localizedDescription ?? "Audio export failed")
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
