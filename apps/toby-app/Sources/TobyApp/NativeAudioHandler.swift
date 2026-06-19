import AVFoundation
import CoreMedia
import Darwin
import Foundation
@preconcurrency import ScreenCaptureKit

@MainActor
final class NativeAudioHandler {
	static let shared = NativeAudioHandler()

	private var session: NativeRecordingSession?
	private var files: [String: String] = [:]
	private var helperVersion = "native-app"

	private init() {}

	func status() -> Data {
		if let session {
			return json([
				"ok": true,
				"data": statePayload(
					status: "recording",
					options: session.options,
					message: "Recording.",
				),
			])
		}
		return json(["ok": true, "data": statePayload(message: "Ready to record audio.")])
	}

	func start(body: Data?) async -> Data {
		guard session == nil else {
			return json(["ok": false, "error": "Already recording."])
		}
		do {
			let sources = parseSources(body: body)
			let prepared = try prepareSession(sources: sources)
			let recording = NativeRecordingSession(options: prepared.options)
			session = recording
			files = try await recording.start()
			return json([
				"ok": true,
				"data": statePayload(
					status: "recording",
					session: prepared,
					message: "Recording.",
				),
			])
		} catch {
			session = nil
			files = [:]
			return json(["ok": false, "error": "\(error)"])
		}
	}

	func stop(body: Data?) async -> Data {
		guard let session else {
			return json(["ok": false, "error": "No active recording."])
		}
		let discard = parseDiscard(body: body)
		self.session = nil
		await session.stop()
		files = await validatedAudioFiles(files)

		if discard {
			try? FileManager.default.removeItem(at: session.options.tempDir)
			files = [:]
			return json(["ok": true, "data": ["status": "idle", "message": "Recording discarded."]])
		}

		do {
			if let combined = try await exportCombinedAudio(files: files, outDir: session.options.tempDir) {
				files["combined"] = combined
			}
			let finalDir = try save(session: session, files: files)
			var payload: [String: Any] = [
				"status": "idle",
				"message": "Recording saved.",
				"id": session.options.id,
				"outputDir": finalDir.path,
				"files": remapFiles(files, from: session.options.tempDir, to: finalDir),
			]
			if !session.errors.isEmpty {
				payload["errors"] = session.errors
			}
			files = [:]
			return json(["ok": true, "data": payload])
		} catch {
			files = [:]
			return json(["ok": false, "error": "\(error)"])
		}
	}

	private func parseSources(body: Data?) -> NativeListenSources {
		guard let body,
			let raw = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
		else {
			return NativeListenSources(mic: true, system: true)
		}
		let mic = raw["mic"] as? Bool ?? true
		let system = raw["system"] as? Bool ?? true
		return NativeListenSources(mic: mic, system: system)
	}

	private func parseDiscard(body: Data?) -> Bool {
		guard let body,
			let raw = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
		else {
			return false
		}
		return (raw["action"] as? String) == "discard"
	}

	private func prepareSession(sources: NativeListenSources) throws -> PreparedNativeAudioSession {
		guard sources.mic || sources.system else {
			throw NativeAudioError.runtime("At least one listen source must be selected.")
		}
		let now = Date()
		let id = recordingId(date: now)
		let base = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".toby")
		let listenDir = base.appendingPathComponent("listen", isDirectory: true)
		let tempRoot = listenDir.appendingPathComponent("tmp", isDirectory: true)
		let recordingsRoot = listenDir.appendingPathComponent("recordings", isDirectory: true)
		try FileManager.default.createDirectory(at: tempRoot, withIntermediateDirectories: true)
		try FileManager.default.createDirectory(at: recordingsRoot, withIntermediateDirectories: true)
		let tempDir = tempRoot.appendingPathComponent(id, isDirectory: true)
		let finalDir = recordingsRoot.appendingPathComponent(id, isDirectory: true)
		try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
		return PreparedNativeAudioSession(
			id: id,
			startedAt: isoString(now),
			sources: sources,
			options: NativeRecordOptions(
				id: id,
				startedAt: now,
				tempDir: tempDir,
				finalDir: finalDir,
				mic: sources.mic,
				system: sources.system,
			),
		)
	}

	private func save(session: NativeRecordingSession, files: [String: String]) throws -> URL {
		let options = session.options
		let manager = FileManager.default
		let finalDir = options.finalDir
		if manager.fileExists(atPath: finalDir.path) {
			try manager.removeItem(at: finalDir)
		}
		try manager.createDirectory(at: finalDir.deletingLastPathComponent(), withIntermediateDirectories: true)
		try manager.moveItem(at: options.tempDir, to: finalDir)
		let stoppedAt = Date()
		let remapped = remapFiles(files, from: options.tempDir, to: finalDir)
		let capturedSources = ["mic": remapped["mic"] != nil, "system": remapped["system"] != nil]
		var metadata: [String: Any] = [
			"id": options.id,
			"createdAt": isoString(options.startedAt),
			"startedAt": isoString(options.startedAt),
			"stoppedAt": isoString(stoppedAt),
			"durationMs": max(0, Int(stoppedAt.timeIntervalSince(options.startedAt) * 1000)),
			"sources": capturedSources,
			"files": remapped,
			"platform": "darwin",
			"osVersion": ProcessInfo.processInfo.operatingSystemVersionString,
			"helper": ["path": "Toby.app", "version": helperVersion],
		]
		if !session.errors.isEmpty {
			metadata["errors"] = session.errors
		}
		if !JSONSerialization.isValidJSONObject(metadata) {
			metadata["files"] = [:]
		}
		let data = try JSONSerialization.data(withJSONObject: metadata, options: [.prettyPrinted, .sortedKeys])
		try data.write(to: finalDir.appendingPathComponent("metadata.json"), options: .atomic)
		return finalDir
	}

	private func remapFiles(_ files: [String: String], from tempDir: URL, to finalDir: URL) -> [String: String] {
		var out: [String: String] = [:]
		for (key, value) in files {
			let path = URL(fileURLWithPath: value)
			if path.path.hasPrefix(tempDir.path + "/") {
				out[key] = finalDir.appendingPathComponent(path.lastPathComponent).path
			} else {
				out[key] = value
			}
		}
		return out
	}

	private func statePayload(
		status: String = "idle",
		session: PreparedNativeAudioSession? = nil,
		message: String,
	) -> [String: Any] {
		var payload: [String: Any] = ["status": status, "message": message]
		if let session {
			payload["session"] = [
				"id": session.id,
				"startedAt": session.startedAt,
				"sources": ["mic": session.sources.mic, "system": session.sources.system],
			]
			payload["outputDir"] = session.options.finalDir.path
		}
		return payload
	}

	private func statePayload(
		status: String,
		options: NativeRecordOptions,
		message: String,
	) -> [String: Any] {
		[
			"status": status,
			"message": message,
			"session": [
				"id": options.id,
				"startedAt": isoString(options.startedAt),
				"sources": ["mic": options.mic, "system": options.system],
			],
			"outputDir": options.finalDir.path,
		]
	}
}

struct NativeListenSources {
	let mic: Bool
	let system: Bool
}

struct PreparedNativeAudioSession {
	let id: String
	let startedAt: String
	let sources: NativeListenSources
	let options: NativeRecordOptions
}

struct NativeRecordOptions {
	let id: String
	let startedAt: Date
	let tempDir: URL
	let finalDir: URL
	let mic: Bool
	let system: Bool
}

enum NativeAudioError: Error, CustomStringConvertible {
	case permission(String)
	case runtime(String)

	var description: String {
		switch self {
		case .permission(let message), .runtime(let message):
			return message
		}
	}
}

final class NativeMicrophoneRecorder {
	private var recorder: AVAudioRecorder?
	let url: URL

	init(url: URL) {
		self.url = url
	}

	func start() throws {
		let settings: [String: Any] = [
			AVFormatIDKey: kAudioFormatLinearPCM,
			AVSampleRateKey: 48_000,
			AVNumberOfChannelsKey: 1,
			AVLinearPCMBitDepthKey: 16,
			AVLinearPCMIsFloatKey: false,
			AVLinearPCMIsBigEndianKey: false,
		]
		let recorder = try AVAudioRecorder(url: url, settings: settings)
		recorder.prepareToRecord()
		guard recorder.record() else {
			throw NativeAudioError.runtime("Could not start microphone recording.")
		}
		self.recorder = recorder
	}

	func stop() {
		recorder?.stop()
		recorder = nil
	}
}

final class NativeSystemAudioRecorder: NSObject, SCStreamOutput, SCStreamDelegate {
	private let url: URL
	private let queue = DispatchQueue(label: "toby.native-app.system-audio")
	private var stream: SCStream?
	private var writer: AVAssetWriter?
	private var input: AVAssetWriterInput?
	private var startedWriting = false
	private(set) var didWriteAudio = false

	init(url: URL) {
		self.url = url
	}

	@MainActor
	func start() async throws {
		let content = try await SCShareableContent.excludingDesktopWindows(
			false,
			onScreenWindowsOnly: true,
		)
		guard let display = content.displays.first else {
			throw NativeAudioError.runtime("No display available for system audio capture.")
		}
		let filter = SCContentFilter(display: display, excludingWindows: [])
		let config = SCStreamConfiguration()
		config.width = 2
		config.height = 2
		config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
		config.capturesAudio = true
		config.excludesCurrentProcessAudio = true

		let stream = SCStream(filter: filter, configuration: config, delegate: self)
		try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
		try await stream.startCapture()
		self.stream = stream
	}

	@MainActor
	func stop() async {
		if let stream {
			try? await stream.stopCapture()
		}
		input?.markAsFinished()
		if let writer, startedWriting {
			await withCheckedContinuation { continuation in
				writer.finishWriting {
					continuation.resume()
				}
			}
		}
		stream = nil
		writer = nil
		input = nil
	}

	func stream(
		_ stream: SCStream,
		didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
		of type: SCStreamOutputType,
	) {
		guard type == .audio,
			sampleBuffer.isValid,
			CMSampleBufferDataIsReady(sampleBuffer)
		else {
			return
		}
		try? append(sampleBuffer)
	}

	func stream(_ stream: SCStream, didStopWithError error: Error) {}

	private func append(_ sampleBuffer: CMSampleBuffer) throws {
		if writer == nil {
			try configureWriter(from: sampleBuffer)
		}
		guard let writer, let input else { return }
		if !startedWriting {
			let time = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
			writer.startWriting()
			writer.startSession(atSourceTime: time)
			startedWriting = true
		}
		if input.isReadyForMoreMediaData {
			if input.append(sampleBuffer) {
				didWriteAudio = true
			}
		}
	}

	private func configureWriter(from sampleBuffer: CMSampleBuffer) throws {
		guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
			let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription)
		else {
			throw NativeAudioError.runtime("Could not inspect system audio format.")
		}
		let settings: [String: Any] = [
			AVFormatIDKey: kAudioFormatLinearPCM,
			AVSampleRateKey: asbd.pointee.mSampleRate,
			AVNumberOfChannelsKey: Int(asbd.pointee.mChannelsPerFrame),
			AVLinearPCMBitDepthKey: 16,
			AVLinearPCMIsFloatKey: false,
			AVLinearPCMIsBigEndianKey: false,
			AVLinearPCMIsNonInterleaved: false,
		]
		let writer = try AVAssetWriter(outputURL: url, fileType: .wav)
		let input = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
		input.expectsMediaDataInRealTime = true
		guard writer.canAdd(input) else {
			throw NativeAudioError.runtime("Could not add system audio writer input.")
		}
		writer.add(input)
		self.writer = writer
		self.input = input
	}
}

@MainActor
final class NativeRecordingSession {
	let options: NativeRecordOptions
	private(set) var errors: [String] = []
	private var micRecorder: NativeMicrophoneRecorder?
	private var systemRecorder: NativeSystemAudioRecorder?

	init(options: NativeRecordOptions) {
		self.options = options
	}

	func start() async throws -> [String: String] {
		try FileManager.default.createDirectory(
			at: options.tempDir,
			withIntermediateDirectories: true,
		)
		var files: [String: String] = [:]
		if options.mic {
			do {
				let granted = await AVAudioApplication.requestRecordPermission()
				guard granted else {
					throw NativeAudioError.permission("Microphone permission denied.")
				}
				let url = options.tempDir.appendingPathComponent("mic.wav")
				let recorder = NativeMicrophoneRecorder(url: url)
				try recorder.start()
				micRecorder = recorder
				files["mic"] = url.path
			} catch {
				errors.append("\(error)")
			}
		}
		if options.system {
			do {
				let url = options.tempDir.appendingPathComponent("system.wav")
				let recorder = NativeSystemAudioRecorder(url: url)
				try await recorder.start()
				systemRecorder = recorder
				files["system"] = url.path
			} catch {
				errors.append("\(error)")
			}
		}
		if files.isEmpty {
			throw NativeAudioError.runtime(errors.first ?? "Could not start audio recording.")
		}
		return files
	}

	func stop() async {
		micRecorder?.stop()
		let didWriteSystemAudio = systemRecorder?.didWriteAudio ?? false
		await systemRecorder?.stop()
		if options.system && !didWriteSystemAudio {
			errors.append("System audio was enabled, but no system audio was captured. Check Screen Recording permission and make sure another app is producing audio.")
		}
		micRecorder = nil
		systemRecorder = nil
	}
}

func validatedAudioFiles(_ files: [String: String]) async -> [String: String] {
	var valid: [String: String] = [:]
	for (key, path) in files {
		let url = URL(fileURLWithPath: path)
		guard FileManager.default.fileExists(atPath: url.path) else { continue }
		let asset = AVURLAsset(url: url)
		if let tracks = try? await asset.loadTracks(withMediaType: .audio), !tracks.isEmpty {
			valid[key] = path
		}
	}
	return valid
}

func exportCombinedAudio(files: [String: String], outDir: URL) async throws -> String? {
	let sourceURLs = ["mic", "system"]
		.compactMap { files[$0] }
		.map { URL(fileURLWithPath: $0) }
		.filter { FileManager.default.fileExists(atPath: $0.path) }
	if sourceURLs.isEmpty {
		return nil
	}

	let composition = AVMutableComposition()
	var insertedAnyTrack = false
	for url in sourceURLs {
		let asset = AVURLAsset(url: url)
		guard let sourceTrack = try await asset.loadTracks(withMediaType: .audio).first else {
			continue
		}
		let duration = try await asset.load(.duration)
		guard let compositionTrack = composition.addMutableTrack(
			withMediaType: .audio,
			preferredTrackID: kCMPersistentTrackID_Invalid,
		) else {
			continue
		}
		try compositionTrack.insertTimeRange(
			CMTimeRange(start: .zero, duration: duration),
			of: sourceTrack,
			at: .zero,
		)
		insertedAnyTrack = true
	}
	guard insertedAnyTrack else {
		return nil
	}

	let combinedURL = outDir.appendingPathComponent("combined.m4a")
	let partialURL = outDir.appendingPathComponent(".combined.\(UUID().uuidString).partial.m4a")
	defer {
		if FileManager.default.fileExists(atPath: partialURL.path) {
			try? FileManager.default.removeItem(at: partialURL)
		}
	}
	guard let exportSession = AVAssetExportSession(
		asset: composition,
		presetName: AVAssetExportPresetAppleM4A,
	) else {
		throw NativeAudioError.runtime("Could not create combined audio export session.")
	}
	exportSession.outputURL = partialURL
	exportSession.outputFileType = .m4a
	await withCheckedContinuation { continuation in
		exportSession.exportAsynchronously {
			continuation.resume()
		}
	}
	if exportSession.status == .completed {
		try FileManager.default.moveItem(at: partialURL, to: combinedURL)
		return combinedURL.path
	}
	throw NativeAudioError.runtime(exportSession.error?.localizedDescription ?? "Could not export combined audio.")
}

private func recordingId(date: Date) -> String {
	let formatter = ISO8601DateFormatter()
	formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
	return "\(formatter.string(from: date).replacingOccurrences(of: ":", with: "-").replacingOccurrences(of: ".", with: "-"))-\(UUID().uuidString.prefix(6))"
}

private func isoString(_ date: Date) -> String {
	let formatter = ISO8601DateFormatter()
	formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
	return formatter.string(from: date)
}

private func json(_ payload: [String: Any]) -> Data {
	guard JSONSerialization.isValidJSONObject(payload),
		let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
	else {
		return Data("{\"ok\":false,\"error\":\"encoding error\"}".utf8)
	}
	return data
}
