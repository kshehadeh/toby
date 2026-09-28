import AVFoundation
import Foundation
import Speech

/// File retries use the same on-device engine, without starting another capture.
@MainActor
enum NativeSpeechFileTranscription {
	static func run(body: Data?) async -> Data {
		do {
			guard let body, let request = try JSONSerialization.jsonObject(with: body) as? [String: Any],
				let input = request["input"] as? String else {
				throw NativeAudioError.runtime("Missing input audio path.")
			}
			guard SpeechTranscriber.isAvailable,
				let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale.current) else {
				throw NativeAudioError.runtime("Apple transcription is unavailable for this Mac or language. Choose another provider in Settings → Transcription.")
			}
			let transcriber = SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [], attributeOptions: [.audioTimeRange])
			if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
				try await request.downloadAndInstall()
			}
			let analyzer = SpeechAnalyzer(modules: [transcriber])
			let results = Task { () throws -> [LiveTranscriptSegment] in
				var segments: [LiveTranscriptSegment] = []
				for try await result in transcriber.results {
					segments.append(LiveTranscriptSegment(id: "\(result.range.start.seconds)", text: String(result.text.characters), timestamp: result.range.start.seconds, duration: result.range.duration.seconds, source: "recording", isFinal: true))
				}
				return segments
			}
			let segments: [LiveTranscriptSegment]
			do {
				let file = try AVAudioFile(forReading: URL(fileURLWithPath: input))
				if let last = try await analyzer.analyzeSequence(from: file) {
					try await analyzer.finalizeAndFinish(through: last)
				} else { await analyzer.cancelAndFinishNow() }
				segments = try await results.value
			} catch {
				await analyzer.cancelAndFinishNow()
				results.cancel()
				throw error
			}
			let text = segments.map(\.text).joined(separator: " ")
			guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
				throw NativeAudioError.runtime("No speech was recognized. Audio has been kept for retry.")
			}
			return try JSONSerialization.data(withJSONObject: ["ok": true, "data": [
				"text": text, "locale": locale.identifier, "sourceAudio": URL(fileURLWithPath: input).lastPathComponent,
				"createdAt": ISO8601DateFormatter().string(from: Date()),
				"segments": segments.map { ["text": $0.text, "timestamp": $0.timestamp, "duration": $0.duration, "confidence": 1.0, "alternatives": [] as [String]] as [String: Any] },
			]])
		} catch {
			return (try? JSONSerialization.data(withJSONObject: ["ok": false, "error": String(describing: error)])) ?? Data()
		}
	}
}
