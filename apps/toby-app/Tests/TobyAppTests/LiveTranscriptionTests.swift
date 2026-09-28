import AVFoundation
import Foundation
import Testing
import SwiftUI
@testable import TobyApp
import ViewInspector

@MainActor
@Suite("Live transcription")
struct LiveTranscriptionTests {
	private func segment(_ text: String, source: String = "mic", start: Double = 0, final: Bool = false) -> LiveTranscriptSegment {
		LiveTranscriptSegment(id: "\(source)-\(start)", text: text, timestamp: start, duration: 2, source: source, isFinal: final)
	}

	@Test("revisions replace provisional words without duplicating finalized text or another source")
	func revisions() {
		var transcript = LiveTranscriptSnapshot()
		transcript.accept(segment("Hello whirled"))
		transcript.accept(segment("Remote speaker", source: "system", final: true))
		transcript.accept(segment("Hello world", final: true))
		transcript.accept(segment("Next sentence", start: 2))
		#expect(transcript.segments.map(\.text) == ["Hello world", "Remote speaker", "Next sentence"])
		#expect(transcript.segments.filter(\.isFinal).count == 2)
	}

	@Test("changed provisional ranges replace overlapping guesses")
	func overlappingRanges() {
		var transcript = LiveTranscriptSnapshot()
		transcript.accept(segment("Guess", start: 1))
		transcript.accept(segment("Corrected", start: 0, final: true))
		#expect(transcript.segments.map(\.text) == ["Corrected"])
	}

	@Test("status decoding carries live text into the active recording and supports older responses")
	func statusDecoding() throws {
		let old = Data(#"{"status":"recording","session":{"id":"r1","startedAt":"2026-09-28T12:00:00Z","sources":{"mic":true,"system":false}}}"#.utf8)
		let status = try JSONDecoder().decode(ListenStatusResponse.self, from: old)
		#expect(status.liveTranscript == nil)
		var live = status
		live.liveTranscript = LiveTranscriptSnapshot(segments: [segment("Hello", final: true)])
		#expect(ActiveRecordingInfo(live)?.liveTranscript?.segments.first?.text == "Hello")
	}

	@Test("live transcript exposes setup and failure states")
	func transcriptStates() throws {
		let waiting = LiveRecordingTranscriptView(transcript: LiveTranscriptSnapshot(message: "Downloading Apple speech language model…"))
		#expect(throws: Never.self) { try waiting.inspect().find(text: "Downloading Apple speech language model…") }
		let failed = LiveRecordingTranscriptView(transcript: LiveTranscriptSnapshot(error: "Language unavailable"))
		#expect(throws: Never.self) { try failed.inspect().find(text: "Language unavailable") }
	}

	@Test("active recorder mounts live transcript and preserves stop control")
	func activeRecorder() throws {
		var active = ActiveRecordingInfo(id: "r1", startedAt: "2026-09-28T12:00:00Z", sources: .init(mic: true, system: true))
		active.liveTranscript = LiveTranscriptSnapshot()
		let view = ActiveRecordingDetailView(active: active, onStopRecording: {})
		#expect(throws: Never.self) { try view.inspect().find(viewWithAccessibilityIdentifier: "live-recording-transcript") }
		#expect(throws: Never.self) { try view.inspect().find(viewWithAccessibilityIdentifier: "active-stop-recording-button") }
	}

	@Test("audio conversion preserves order and stops accepting input after finish")
	func audioFeed() async throws {
		let input = try #require(AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1))
		let output = try #require(AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1))
		let buffer = try #require(AVAudioPCMBuffer(pcmFormat: input, frameCapacity: 4800))
		buffer.frameLength = 4800
		memset(buffer.floatChannelData![0], 0, 4800 * MemoryLayout<Float>.size)
		let feed = SpeechAudioFeed(format: output, startedAt: Date())
		feed.append(buffer)
		feed.append(buffer)
		feed.finish()
		feed.append(buffer)
		var times: [Double] = []
		for await input in feed.stream { times.append(try #require(input.bufferStartTime).seconds) }
		#expect(times.count == 2)
		#expect(times[1] > times[0])
		#expect(feed.error == nil)
	}

	@Test("on-device recognition transcribes a synthetic audio fixture", .enabled(if: ProcessInfo.processInfo.environment["TOBY_SPEECH_TEST_AUDIO"] != nil))
	func nativeRecognition() async throws {
		let path = try #require(ProcessInfo.processInfo.environment["TOBY_SPEECH_TEST_AUDIO"])
		let body = try JSONSerialization.data(withJSONObject: ["input": path])
		let response = await NativeSpeechFileTranscription.run(body: body)
		let json = try #require(JSONSerialization.jsonObject(with: response) as? [String: Any])
		#expect(json["ok"] as? Bool == true, "\(json["error"] ?? "")")
		let payload = try #require(json["data"] as? [String: Any])
		#expect((payload["text"] as? String)?.lowercased().contains("recording") == true)
	}
	@Test("live dual-source recognition saves finalized timestamped text", .enabled(if: ProcessInfo.processInfo.environment["TOBY_SPEECH_TEST_AUDIO"] != nil))
	func liveRecognition() async throws {
		let path = try #require(ProcessInfo.processInfo.environment["TOBY_SPEECH_TEST_AUDIO"])
		let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
		try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
		defer { try? FileManager.default.removeItem(at: directory) }
		let speech = NativeSpeechTranscriber()
		let feeds = try await speech.prepare(sources: ["mic", "system"], startedAt: Date())
		let file = try AVAudioFile(forReading: URL(fileURLWithPath: path))
		let buffer = try #require(AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 4096))
		while file.framePosition < file.length {
			try file.read(into: buffer)
			for feed in feeds.values { feed.append(buffer) }
		}
		await speech.finish()
		#expect(speech.snapshot.error == nil)
		let files = try speech.write(to: directory)
		#expect(files["transcriptJson"] != nil)
		#expect(speech.snapshot.segments.allSatisfy { $0.isFinal })
		#expect(Set(speech.snapshot.segments.map(\.source)) == ["mic", "system"])
		let text = try String(contentsOf: directory.appendingPathComponent("transcript.txt"), encoding: .utf8)
		#expect(text.lowercased().contains("recording"))
	}

}
