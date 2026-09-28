import AVFoundation
import CoreMedia
import Foundation
import Speech

struct LiveTranscriptSegment: Codable, Equatable, Identifiable, Sendable {
	let id: String
	let text: String
	let timestamp: Double
	let duration: Double
	let source: String
	let isFinal: Bool
}

/// Replacement is keyed by audio range, not by text: provisional words can change.
struct LiveTranscriptSnapshot: Codable, Equatable, Sendable {
	var segments: [LiveTranscriptSegment] = []
	var message: String = "Preparing on-device transcription…"
	var error: String?

	mutating func accept(_ segment: LiveTranscriptSegment) {
		segments.removeAll {
			$0.source == segment.source && !$0.isFinal &&
			$0.timestamp < segment.timestamp + max(segment.duration, 0.001) &&
			$0.timestamp + max($0.duration, 0.001) > segment.timestamp
		}
		segments.removeAll { $0.id == segment.id }
		segments.append(segment)
		segments.sort { $0.timestamp == $1.timestamp ? $0.source < $1.source : $0.timestamp < $1.timestamp }
	}
}

@MainActor
final class NativeSpeechTranscriber {
	private(set) var snapshot = LiveTranscriptSnapshot()
	private var channels: [SpeechChannel] = []
	var statusSnapshot: LiveTranscriptSnapshot {
		var value = snapshot
		value.error = value.error ?? channels.compactMap { $0.feed.error }.first
		return value
	}
	private(set) var locale = Locale.current

	static var selected: Bool {
		let url = URL(fileURLWithPath: ConfigReader.resolveTobyDir()).appendingPathComponent("config.json")
		guard let data = try? Data(contentsOf: url),
			let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
			let config = root["transcription"] as? [String: Any]
		else { return false }
		return config["provider"] as? String == "apple"
	}

	func prepare(sources: [String], startedAt: Date) async throws -> [String: SpeechAudioFeed] {
		guard SpeechTranscriber.isAvailable else {
			throw NativeAudioError.runtime("Apple transcription is unavailable on this Mac. Choose another provider in Settings → Transcription.")
		}
		guard let supported = await SpeechTranscriber.supportedLocale(equivalentTo: locale) else {
			throw NativeAudioError.runtime("Apple transcription does not support \(locale.localizedString(forIdentifier: locale.identifier) ?? locale.identifier). Change your Mac’s language or choose another provider in Settings → Transcription.")
		}
		locale = supported
		var feeds: [String: SpeechAudioFeed] = [:]
		for source in sources {
			let transcriber = SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [.volatileResults], attributeOptions: [.audioTimeRange])
			if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
				snapshot.message = "Downloading Apple speech language model…"
				try await request.downloadAndInstall()
			}
			guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
				throw NativeAudioError.runtime("Apple transcription could not find a supported audio format.")
			}
			let channel = SpeechChannel(transcriber: transcriber, format: format, source: source, startedAt: startedAt) { [weak self] segment in
				self?.snapshot.accept(segment)
			} onError: { [weak self] message in
				self?.snapshot.error = message
			}
			channels.append(channel)
			try await channel.start()
			feeds[source] = channel.feed
		}
		snapshot.message = "Listening on device…"
		return feeds
	}

	func finish() async {
		for channel in channels {
			do { try await channel.finish() }
			catch {
				snapshot.error = "Apple transcription failed: \(error.localizedDescription)"
				await channel.cancel()
			}
		}
		channels.removeAll()
	}

	func cancel() async {
		for channel in channels { await channel.cancel() }
		channels.removeAll()
	}

	func fail(_ error: Error) {
		snapshot.error = "Live transcription unavailable: \(error) Audio is still being recorded."
	}

	func write(to directory: URL) throws -> [String: String] {
		if let error = snapshot.error { throw NativeAudioError.runtime(error) }
		let segments = snapshot.segments.filter(\.isFinal)
		let text = segments.map(\.text).joined(separator: " ")
		guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
			throw NativeAudioError.runtime("No speech was recognized. Audio has been kept for retry.")
		}
		let payload: [String: Any] = [
			"engine": "apple-live", "complete": true, "text": text, "locale": locale.identifier, "sourceAudio": "combined.m4a",
			"createdAt": ISO8601DateFormatter().string(from: Date()),
			"segments": segments.map { ["text": $0.text, "timestamp": $0.timestamp, "duration": $0.duration, "confidence": 1.0, "alternatives": [] as [String], "source": $0.source] as [String: Any] },
		]
		try (text + "\n").write(to: directory.appendingPathComponent("transcript.txt"), atomically: true, encoding: .utf8)
		try JSONSerialization.data(withJSONObject: payload).write(to: directory.appendingPathComponent("transcript.json"), options: .atomic)
		return ["transcript": directory.appendingPathComponent("transcript.txt").path, "transcriptJson": directory.appendingPathComponent("transcript.json").path]
	}
}

@MainActor
private final class SpeechChannel {
	let feed: SpeechAudioFeed
	private let analyzer: SpeechAnalyzer
	private var resultsTask: Task<Void, Error>?
	private let transcriber: SpeechTranscriber
	private let source: String
	private let onResult: (LiveTranscriptSegment) -> Void
	private let onError: (String) -> Void

	init(transcriber: SpeechTranscriber, format: AVAudioFormat, source: String, startedAt: Date,
		onResult: @escaping (LiveTranscriptSegment) -> Void, onError: @escaping (String) -> Void) {
		self.transcriber = transcriber
		self.source = source
		self.onResult = onResult
		self.onError = onError
		analyzer = SpeechAnalyzer(modules: [transcriber])
		feed = SpeechAudioFeed(format: format, startedAt: startedAt)
	}

	func start() async throws {
		resultsTask = Task {
			do {
				for try await result in transcriber.results {
					let start = result.range.start.seconds
					onResult(LiveTranscriptSegment(id: "\(source)-\(start)", text: String(result.text.characters), timestamp: start, duration: result.range.duration.seconds, source: source, isFinal: result.isFinal))
				}
			} catch {
				onError("Apple transcription failed: \(error.localizedDescription)")
				throw error
			}
		}
		try await analyzer.start(inputSequence: feed.stream)
	}

	func finish() async throws {
		feed.finish()
		try await analyzer.finalizeAndFinishThroughEndOfInput()
		try await resultsTask?.value
		if let error = feed.error { throw NativeAudioError.runtime(error) }
	}

	func cancel() async {
		feed.finish()
		await analyzer.cancelAndFinishNow()
		resultsTask?.cancel()
		_ = try? await resultsTask?.value
	}
}

/// Capture callbacks serialize conversion with a lock; the bounded stream prevents
/// a stalled recognizer from retaining an entire meeting's audio in memory.
final class SpeechAudioFeed: @unchecked Sendable {
	let stream: AsyncStream<AnalyzerInput>
	private let continuation: AsyncStream<AnalyzerInput>.Continuation
	private let lock = NSLock()
	private let format: AVAudioFormat
	private var startedAt: Date
	private var converter: AVAudioConverter?
	private var nextTime: CMTime?
	private var failure: String?
	private var finished = false
	var error: String? { lock.withLock { failure } }

	init(format: AVAudioFormat, startedAt: Date) {
		self.format = format
		self.startedAt = startedAt
		(stream, continuation) = AsyncStream.makeStream(bufferingPolicy: .bufferingOldest(256))
	}

	func begin(at date: Date) { lock.withLock { startedAt = date; nextTime = nil } }

	func append(_ buffer: AVAudioPCMBuffer) {
		lock.withLock {
			guard !finished, failure == nil else { return }
			if converter?.inputFormat != buffer.format {
				converter = AVAudioConverter(from: buffer.format, to: format)
			}
			guard let converter,
				let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(ceil(Double(buffer.frameLength) * format.sampleRate / buffer.format.sampleRate)) + 32)
			else { failure = "Could not convert audio for Apple transcription."; return }
			var supplied = false
			var error: NSError?
			let status = converter.convert(to: output, error: &error) { _, state in
				if supplied { state.pointee = .noDataNow; return nil }
				supplied = true
				state.pointee = .haveData
				return buffer
			}
			guard status != .error else { failure = error?.localizedDescription ?? "Audio conversion failed."; return }
			guard output.frameLength > 0 else { return }
			// Use exact output-frame time, not accumulated floating-point seconds.
			// A sub-sample rounding overlap is rejected by SpeechAnalyzer.
			let timescale = CMTimeScale(format.sampleRate)
			let time = nextTime ?? CMTime(seconds: max(0, Date().timeIntervalSince(startedAt) - Double(buffer.frameLength) / buffer.format.sampleRate), preferredTimescale: timescale)
			nextTime = time + CMTime(value: Int64(output.frameLength), timescale: timescale)
			if case .dropped = continuation.yield(AnalyzerInput(buffer: output, bufferStartTime: time)) {
				failure = "Live transcription could not keep up. Audio has been kept for retry."
			}
		}
	}

	func append(_ sample: CMSampleBuffer) {
		guard sample.numSamples > 0 else { return }
		guard let description = sample.formatDescription else {
			lock.withLock { failure = "Could not read system audio for live transcription." }
			return
		}
		let format = AVAudioFormat(cmAudioFormatDescription: description)
		guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(sample.numSamples)) else { return }
		buffer.frameLength = buffer.frameCapacity
		let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(sample, at: 0, frameCount: Int32(sample.numSamples), into: buffer.mutableAudioBufferList)
		if status == noErr { append(buffer) }
		else { lock.withLock { failure = "Could not copy system audio for live transcription." } }
	}

	func finish() {
		lock.withLock { finished = true; continuation.finish() }
	}
}
