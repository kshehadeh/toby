import AVFoundation
import CoreMedia
import Darwin
import Foundation
import ScreenCaptureKit
import Speech

let helperVersion = "0.3.0"
let maxSpeechChunkDurationSeconds: TimeInterval = 55

struct RecordOptions {
	let outDir: URL
	let format: String
	let mic: Bool
	let system: Bool
}

struct TranscribeOptions {
	let input: URL
	let outDir: URL
}

struct CombineOptions {
	let outDir: URL
	let mic: URL?
	let system: URL?
}

enum HelperCommand {
	case record(RecordOptions)
	case combine(CombineOptions)
	case transcribe(TranscribeOptions)
	case transcribeWorker(TranscribeOptions)
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

enum HelperError: Error, CustomStringConvertible {
	case usage(String)
	case unsupported(String)
	case permission(String)
	case runtime(String)

	var description: String {
		switch self {
		case let .usage(message),
			let .unsupported(message),
			let .permission(message),
			let .runtime(message):
			return message
		}
	}
}

struct StopCommand: Decodable {
	let type: String
	let action: String?
}

struct JSONEvent {
	static func emit(_ fields: [String: Any]) {
		guard JSONSerialization.isValidJSONObject(fields),
			let data = try? JSONSerialization.data(withJSONObject: fields),
			let line = String(data: data, encoding: .utf8)
		else {
			return
		}
		print(line)
		fflush(stdout)
	}

	static func status(_ message: String) {
		emit(["type": "status", "message": message])
	}

	static func error(code: String, _ message: String) {
		emit(["type": "error", "code": code, "message": message])
	}

	static func permission(
		service: String,
		status: String,
		message: String? = nil
	) {
		var fields: [String: Any] = [
			"type": "permission",
			"service": service,
			"status": status,
		]
		if let message {
			fields["message"] = message
		}
		emit(fields)
	}
}

func parseCommand(_ args: [String]) throws -> HelperCommand {
	if args == ["--version"] || args == ["version"] {
		print(helperVersion)
		exit(0)
	}
	guard let command = args.first else {
		throw HelperError.usage(
			"Usage: toby-audio-helper record --out-dir <dir> --format wav [--mic] [--system] | transcribe --input <audio-file> --out-dir <dir>"
		)
	}
	switch command {
	case "record":
		return .record(try parseRecordOptions(args))
	case "combine":
		return .combine(try parseCombineOptions(args))
	case "transcribe":
		return .transcribe(try parseTranscribeOptions(args))
	case "transcribe-worker":
		return .transcribeWorker(try parseTranscribeOptions(args))
	default:
		throw HelperError.usage("Unknown command: \(command)")
	}
}

func parseCombineOptions(_ args: [String]) throws -> CombineOptions {
	var outDir: URL?
	var mic: URL?
	var system: URL?
	var index = 1
	while index < args.count {
		let arg = args[index]
		switch arg {
		case "--out-dir":
			index += 1
			guard index < args.count else {
				throw HelperError.usage("--out-dir requires a path")
			}
			outDir = URL(fileURLWithPath: args[index], isDirectory: true)
		case "--mic":
			index += 1
			guard index < args.count else {
				throw HelperError.usage("--mic requires a path")
			}
			mic = URL(fileURLWithPath: args[index])
		case "--system":
			index += 1
			guard index < args.count else {
				throw HelperError.usage("--system requires a path")
			}
			system = URL(fileURLWithPath: args[index])
		default:
			throw HelperError.usage("Unknown argument: \(arg)")
		}
		index += 1
	}
	guard let outDir else {
		throw HelperError.usage("--out-dir is required")
	}
	if mic == nil && system == nil {
		let defaultMic = outDir.appendingPathComponent("mic.wav")
		let defaultSystem = outDir.appendingPathComponent("system.wav")
		mic = FileManager.default.fileExists(atPath: defaultMic.path) ? defaultMic : nil
		system = FileManager.default.fileExists(atPath: defaultSystem.path) ? defaultSystem : nil
	}
	guard mic != nil || system != nil else {
		throw HelperError.usage("At least one source audio file is required")
	}
	return CombineOptions(outDir: outDir, mic: mic, system: system)
}

func parseRecordOptions(_ args: [String]) throws -> RecordOptions {
	var outDir: URL?
	var format = "wav"
	var mic = false
	var system = false
	var index = 1
	while index < args.count {
		let arg = args[index]
		switch arg {
		case "--out-dir":
			index += 1
			guard index < args.count else {
				throw HelperError.usage("--out-dir requires a path")
			}
			outDir = URL(fileURLWithPath: args[index], isDirectory: true)
		case "--format":
			index += 1
			guard index < args.count else {
				throw HelperError.usage("--format requires a value")
			}
			format = args[index]
		case "--mic":
			mic = true
		case "--system":
			system = true
		default:
			throw HelperError.usage("Unknown argument: \(arg)")
		}
		index += 1
	}
	guard let outDir else {
		throw HelperError.usage("--out-dir is required")
	}
	guard mic || system else {
		throw HelperError.usage("At least one of --mic or --system is required")
	}
	guard format == "wav" else {
		throw HelperError.usage("Only --format wav is currently supported")
	}
	return RecordOptions(outDir: outDir, format: format, mic: mic, system: system)
}

func parseTranscribeOptions(_ args: [String]) throws -> TranscribeOptions {
	var input: URL?
	var outDir: URL?
	var index = 1
	while index < args.count {
		let arg = args[index]
		switch arg {
		case "--input":
			index += 1
			guard index < args.count else {
				throw HelperError.usage("--input requires a path")
			}
			input = URL(fileURLWithPath: args[index])
		case "--out-dir":
			index += 1
			guard index < args.count else {
				throw HelperError.usage("--out-dir requires a path")
			}
			outDir = URL(fileURLWithPath: args[index], isDirectory: true)
		default:
			throw HelperError.usage("Unknown argument: \(arg)")
		}
		index += 1
	}
	guard let input else {
		throw HelperError.usage("--input is required")
	}
	guard FileManager.default.fileExists(atPath: input.path) else {
		throw HelperError.usage("Input audio file does not exist: \(input.path)")
	}
	guard let outDir else {
		throw HelperError.usage("--out-dir is required")
	}
	return TranscribeOptions(input: input, outDir: outDir)
}

func requestMicrophonePermission() async throws {
	JSONEvent.permission(service: "microphone", status: "prompting")
	let granted = await AVCaptureDevice.requestAccess(for: .audio)
	if granted {
		JSONEvent.permission(service: "microphone", status: "granted")
		return
	}
	JSONEvent.permission(service: "microphone", status: "denied")
	throw HelperError.permission(
		"Microphone permission denied. Grant access in System Settings > Privacy & Security > Microphone."
	)
}

func requestSpeechPermission() async throws {
	JSONEvent.permission(service: "speech", status: "prompting")
	let status = await withCheckedContinuation { continuation in
		SFSpeechRecognizer.requestAuthorization { status in
			continuation.resume(returning: status)
		}
	}
	switch status {
	case .authorized:
		JSONEvent.permission(service: "speech", status: "granted")
	case .denied:
		JSONEvent.permission(service: "speech", status: "denied")
		throw HelperError.permission(
			"Speech recognition permission denied. Grant access in System Settings > Privacy & Security > Speech Recognition."
		)
	case .restricted:
		JSONEvent.permission(service: "speech", status: "denied")
		throw HelperError.permission("Speech recognition is restricted on this Mac.")
	case .notDetermined:
		JSONEvent.permission(service: "speech", status: "unknown")
		throw HelperError.permission("Speech recognition permission was not determined.")
	@unknown default:
		JSONEvent.permission(service: "speech", status: "unknown")
		throw HelperError.permission("Unknown speech recognition permission status.")
	}
}

final class MicrophoneRecorder {
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
			throw HelperError.runtime("Could not start microphone recording")
		}
		self.recorder = recorder
	}

	func stop() {
		recorder?.stop()
		recorder = nil
	}
}

final class SystemAudioRecorder: NSObject, SCStreamOutput, SCStreamDelegate {
	private let url: URL
	private let queue = DispatchQueue(label: "toby.audio-helper.system-audio")
	private var stream: SCStream?
	private var writer: AVAssetWriter?
	private var input: AVAssetWriterInput?
	private var startedWriting = false
	private var firstAudioTime: CMTime?

	init(url: URL) {
		self.url = url
	}

	func start() async throws {
		JSONEvent.permission(
			service: "screen",
			status: "prompting",
			message: "System audio uses ScreenCaptureKit permissions."
		)
		let content = try await SCShareableContent.excludingDesktopWindows(
			false,
			onScreenWindowsOnly: true
		)
		guard let display = content.displays.first else {
			throw HelperError.runtime("No display available for system audio capture")
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
		JSONEvent.permission(service: "screen", status: "granted")
	}

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
		of type: SCStreamOutputType
	) {
		guard type == .audio,
			sampleBuffer.isValid,
			CMSampleBufferDataIsReady(sampleBuffer)
		else {
			return
		}
		do {
			try append(sampleBuffer)
		} catch {
			JSONEvent.error(code: "system_audio_write_failed", "\(error)")
		}
	}

	private func append(_ sampleBuffer: CMSampleBuffer) throws {
		if writer == nil {
			try configureWriter(from: sampleBuffer)
		}
		guard let writer, let input else { return }
		if !startedWriting {
			let time = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
			firstAudioTime = time
			writer.startWriting()
			writer.startSession(atSourceTime: time)
			startedWriting = true
		}
		if input.isReadyForMoreMediaData {
			input.append(sampleBuffer)
		}
	}

	private func configureWriter(from sampleBuffer: CMSampleBuffer) throws {
		guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
			let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription)
		else {
			throw HelperError.runtime("Could not inspect system audio format")
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
			throw HelperError.runtime("Could not add system audio writer input")
		}
		writer.add(input)
		self.writer = writer
		self.input = input
	}

	func stream(_ stream: SCStream, didStopWithError error: Error) {
		JSONEvent.error(code: "system_audio_stopped", "\(error)")
	}
}

final class RecordingSession {
	let options: RecordOptions
	let startedAt = Date()
	private var micRecorder: MicrophoneRecorder?
	private var systemRecorder: SystemAudioRecorder?

	init(options: RecordOptions) {
		self.options = options
	}

	func start() async throws -> [String: String] {
		try FileManager.default.createDirectory(
			at: options.outDir,
			withIntermediateDirectories: true
		)
		var files: [String: String] = [:]
		if options.mic {
			try await requestMicrophonePermission()
			let url = options.outDir.appendingPathComponent("mic.wav")
			let recorder = MicrophoneRecorder(url: url)
			try recorder.start()
			micRecorder = recorder
			files["mic"] = url.path
		}
		if options.system {
			let url = options.outDir.appendingPathComponent("system.wav")
			let recorder = SystemAudioRecorder(url: url)
			try await recorder.start()
			systemRecorder = recorder
			files["system"] = url.path
		}
		JSONEvent.emit([
			"type": "ready",
			"helperVersion": helperVersion,
			"files": files,
		])
		JSONEvent.status("recording")
		return files
	}

	func stop() async {
		micRecorder?.stop()
		await systemRecorder?.stop()
		micRecorder = nil
		systemRecorder = nil
	}

	func durationMs() -> Int {
		Int(Date().timeIntervalSince(startedAt) * 1000)
	}
}

func publishFile(from sourceURL: URL, to destinationURL: URL) throws {
	if rename(sourceURL.path, destinationURL.path) != 0 {
		throw HelperError.runtime(
			"Could not publish \(destinationURL.lastPathComponent): \(String(cString: strerror(errno)))"
		)
	}
}

func atomicWriteData(_ data: Data, to destinationURL: URL) throws {
	let partialURL = destinationURL.deletingLastPathComponent().appendingPathComponent(
		".\(destinationURL.deletingPathExtension().lastPathComponent).\(UUID().uuidString).partial.\(destinationURL.pathExtension)"
	)
	defer {
		if FileManager.default.fileExists(atPath: partialURL.path) {
			try? FileManager.default.removeItem(at: partialURL)
		}
	}
	try data.write(to: partialURL, options: .atomic)
	try publishFile(from: partialURL, to: destinationURL)
}

func isoTimestamp(_ date: Date = Date()) -> String {
	let formatter = ISO8601DateFormatter()
	formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
	return formatter.string(from: date)
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
			preferredTrackID: kCMPersistentTrackID_Invalid
		) else {
			continue
		}
		try compositionTrack.insertTimeRange(
			CMTimeRange(start: .zero, duration: duration),
			of: sourceTrack,
			at: .zero
		)
		insertedAnyTrack = true
	}
	guard insertedAnyTrack else {
		return nil
	}

	let combinedURL = outDir.appendingPathComponent("combined.m4a")
	let partialURL = outDir.appendingPathComponent(
		".combined.\(UUID().uuidString).partial.m4a"
	)
	defer {
		if FileManager.default.fileExists(atPath: partialURL.path) {
			try? FileManager.default.removeItem(at: partialURL)
		}
	}
	guard let exportSession = AVAssetExportSession(
		asset: composition,
		presetName: AVAssetExportPresetAppleM4A
	) else {
		throw HelperError.runtime("Could not create combined audio export session")
	}
	exportSession.outputURL = partialURL
	exportSession.outputFileType = .m4a
	await withCheckedContinuation { continuation in
		exportSession.exportAsynchronously {
			continuation.resume()
		}
	}
	if exportSession.status == .completed {
		let exportedAsset = AVURLAsset(url: partialURL)
		guard try await exportedAsset.loadTracks(withMediaType: .audio).first != nil else {
			throw HelperError.runtime("Combined audio export did not produce an audio track")
		}
		try publishFile(from: partialURL, to: combinedURL)
		return combinedURL.path
	}
	let message = exportSession.error?.localizedDescription ?? "Unknown export failure"
	throw HelperError.runtime("Could not export combined audio: \(message)")
}

func combineAudio(_ options: CombineOptions) async throws -> [String: String] {
	var files: [String: String] = [:]
	if let mic = options.mic {
		files["mic"] = mic.path
	}
	if let system = options.system {
		files["system"] = system.path
	}
	guard let combined = try await exportCombinedAudio(files: files, outDir: options.outDir) else {
		throw HelperError.runtime("Could not combine audio: no usable audio tracks found")
	}
	return ["combined": combined]
}

func transcriptPayload(
	from result: SFSpeechRecognitionResult,
	sourceAudio: URL,
	locale: Locale,
	timeOffset: TimeInterval = 0
) -> TranscriptPayload {
	let transcription = result.bestTranscription
	let segments = transcription.segments.map { segment in
		TranscriptSegment(
			text: segment.substring,
			timestamp: segment.timestamp + timeOffset,
			duration: segment.duration,
			confidence: segment.confidence,
			alternatives: segment.alternativeSubstrings
		)
	}
	return TranscriptPayload(
		text: transcription.formattedString,
		segments: segments,
		sourceAudio: sourceAudio.path,
		createdAt: isoTimestamp(),
		locale: locale.identifier
	)
}

func recognizeSpeech(inputURL: URL) async throws -> TranscriptPayload {
	let locale = Locale.current
	guard let recognizer = SFSpeechRecognizer(locale: locale) else {
		throw HelperError.runtime("Could not create speech recognizer for locale \(locale.identifier)")
	}
	guard recognizer.isAvailable else {
		throw HelperError.runtime("Speech recognizer is not available for locale \(locale.identifier)")
	}
	let request = SFSpeechURLRecognitionRequest(url: inputURL)
	request.shouldReportPartialResults = false
	return try await withCheckedThrowingContinuation { continuation in
		let lock = NSLock()
		var didResume = false
		var latestResult: SFSpeechRecognitionResult?
		var task: SFSpeechRecognitionTask?
		func resumeOnce(_ result: Result<TranscriptPayload, Error>) {
			lock.lock()
			defer { lock.unlock() }
			guard !didResume else { return }
			didResume = true
			task?.cancel()
			continuation.resume(with: result)
		}
		task = recognizer.recognitionTask(with: request) { result, error in
			if let result {
				latestResult = result
				if result.isFinal {
					resumeOnce(.success(transcriptPayload(
						from: result,
						sourceAudio: inputURL,
						locale: locale
					)))
					return
				}
			}
			if let error {
				if let latestResult {
					resumeOnce(.success(transcriptPayload(
						from: latestResult,
						sourceAudio: inputURL,
						locale: locale
					)))
					return
				}
				resumeOnce(.failure(error))
			}
		}
	}
}

func exportAudioChunk(
	inputURL: URL,
	start: TimeInterval,
	duration: TimeInterval,
	tempDir: URL,
	index: Int
) async throws -> URL {
	let asset = AVURLAsset(url: inputURL)
	let chunkURL = tempDir.appendingPathComponent(
		"chunk-\(String(format: "%04d", index)).m4a"
	)
	if FileManager.default.fileExists(atPath: chunkURL.path) {
		try FileManager.default.removeItem(at: chunkURL)
	}
	guard let exportSession = AVAssetExportSession(
		asset: asset,
		presetName: AVAssetExportPresetAppleM4A
	) else {
		throw HelperError.runtime("Could not create speech chunk export session")
	}
	exportSession.outputURL = chunkURL
	exportSession.outputFileType = .m4a
	exportSession.timeRange = CMTimeRange(
		start: CMTime(seconds: start, preferredTimescale: 600),
		duration: CMTime(seconds: duration, preferredTimescale: 600)
	)
	await withCheckedContinuation { continuation in
		exportSession.exportAsynchronously {
			continuation.resume()
		}
	}
	if exportSession.status == .completed {
		return chunkURL
	}
	let message = exportSession.error?.localizedDescription ?? "Unknown export failure"
	throw HelperError.runtime("Could not export speech chunk: \(message)")
}

func recognizeSpeechInChunks(inputURL: URL) async throws -> TranscriptPayload {
	try await requestSpeechPermission()
	let asset = AVURLAsset(url: inputURL)
	let duration = try await asset.load(.duration).seconds
	guard duration.isFinite && duration > 0 else {
		throw HelperError.runtime("Could not determine audio duration for transcription")
	}
	if duration <= maxSpeechChunkDurationSeconds {
		let payload = try await recognizeSpeech(inputURL: inputURL)
		return TranscriptPayload(
			text: payload.text,
			segments: payload.segments,
			sourceAudio: inputURL.path,
			createdAt: payload.createdAt,
			locale: payload.locale
		)
	}

	let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent(
		"TobyAudioSpeechChunks-\(UUID().uuidString)",
		isDirectory: true
	)
	try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
	defer {
		try? FileManager.default.removeItem(at: tempDir)
	}
	let chunkCount = Int(ceil(duration / maxSpeechChunkDurationSeconds))
	var textParts: [String] = []
	var segments: [TranscriptSegment] = []
	var localeIdentifier = Locale.current.identifier
	for index in 0..<chunkCount {
		let start = TimeInterval(index) * maxSpeechChunkDurationSeconds
		let chunkDuration = min(maxSpeechChunkDurationSeconds, duration - start)
		JSONEvent.status("transcribing audio chunk \(index + 1) of \(chunkCount)")
		let chunkURL = try await exportAudioChunk(
			inputURL: inputURL,
			start: start,
			duration: chunkDuration,
			tempDir: tempDir,
			index: index
		)
		let payload = try await recognizeSpeech(inputURL: chunkURL)
		if !payload.text.isEmpty {
			textParts.append(payload.text)
		}
		segments.append(contentsOf: payload.segments.map { segment in
			TranscriptSegment(
				text: segment.text,
				timestamp: segment.timestamp + start,
				duration: segment.duration,
				confidence: segment.confidence,
				alternatives: segment.alternatives
			)
		})
		localeIdentifier = payload.locale
	}
	return TranscriptPayload(
		text: textParts.joined(separator: "\n"),
		segments: segments,
		sourceAudio: inputURL.path,
		createdAt: isoTimestamp(),
		locale: localeIdentifier
	)
}

func transcribeAudio(inputURL: URL, outDir: URL) async throws -> [String: String] {
	try FileManager.default.createDirectory(
		at: outDir,
		withIntermediateDirectories: true
	)
	JSONEvent.status("transcribing audio")
	let payload = try await recognizeSpeechInChunks(inputURL: inputURL)
	let textURL = outDir.appendingPathComponent("transcript.txt")
	let jsonURL = outDir.appendingPathComponent("transcript.json")
	let encoder = JSONEncoder()
	encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
	let jsonData = try encoder.encode(payload)
	guard let textData = payload.text.appending("\n").data(using: .utf8) else {
		throw HelperError.runtime("Could not encode transcript text")
	}
	try atomicWriteData(textData, to: textURL)
	try atomicWriteData(jsonData, to: jsonURL)
	return [
		"transcript": textURL.path,
		"transcriptJson": jsonURL.path,
	]
}

func speechBundleInfoPlist(executableName: String) -> String {
	"""
	<?xml version="1.0" encoding="UTF-8"?>
	<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
	<plist version="1.0">
	<dict>
		<key>CFBundleExecutable</key>
		<string>\(executableName)</string>
		<key>CFBundleIdentifier</key>
		<string>dev.karim.toby.audio-helper.speech</string>
		<key>CFBundleName</key>
		<string>Toby Audio Helper Speech</string>
		<key>CFBundlePackageType</key>
		<string>APPL</string>
		<key>CFBundleShortVersionString</key>
		<string>1.0</string>
		<key>CFBundleVersion</key>
		<string>1</string>
		<key>NSMicrophoneUsageDescription</key>
		<string>Toby records microphone audio when you use listen mode.</string>
		<key>NSSpeechRecognitionUsageDescription</key>
		<string>Toby uses speech recognition to transcribe saved listen recordings.</string>
	</dict>
	</plist>
	"""
}

struct AppBundleTranscribeResult {
	let status: Int32
	let files: [String: String]
}

func runTranscribeInAppBundle(_ options: TranscribeOptions) throws -> AppBundleTranscribeResult {
	let fileManager = FileManager.default
	let executableName = "toby-audio-helper"
	let bundleURL = fileManager.temporaryDirectory.appendingPathComponent(
		"TobyAudioHelperSpeech-\(UUID().uuidString).app",
		isDirectory: true
	)
	let contentsURL = bundleURL.appendingPathComponent("Contents", isDirectory: true)
	let macOSURL = contentsURL.appendingPathComponent("MacOS", isDirectory: true)
	try fileManager.createDirectory(at: macOSURL, withIntermediateDirectories: true)
	defer {
		try? fileManager.removeItem(at: bundleURL)
	}
	guard let sourceExecutable = Bundle.main.executableURL else {
		throw HelperError.runtime("Could not locate helper executable")
	}
	let bundledExecutable = macOSURL.appendingPathComponent(executableName)
	try fileManager.copyItem(at: sourceExecutable, to: bundledExecutable)
	try fileManager.setAttributes(
		[.posixPermissions: 0o755],
		ofItemAtPath: bundledExecutable.path
	)
	try speechBundleInfoPlist(executableName: executableName).write(
		to: contentsURL.appendingPathComponent("Info.plist"),
		atomically: true,
		encoding: .utf8
	)
	let signProcess = Process()
	signProcess.executableURL = URL(fileURLWithPath: "/usr/bin/codesign")
	signProcess.arguments = ["--force", "--sign", "-", bundleURL.path]
	signProcess.standardOutput = Pipe()
	signProcess.standardError = Pipe()
	try signProcess.run()
	signProcess.waitUntilExit()
	if signProcess.terminationStatus != 0 {
		throw HelperError.runtime("Could not sign Speech transcription helper bundle")
	}

	let process = Process()
	process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
	process.arguments = [
		"-W",
		"-n",
		bundleURL.path,
		"--args",
		"transcribe-worker",
		"--input",
		options.input.path,
		"--out-dir",
		options.outDir.path,
	]
	process.standardError = FileHandle.standardError
	try process.run()
	process.waitUntilExit()
	let textURL = options.outDir.appendingPathComponent("transcript.txt")
	let jsonURL = options.outDir.appendingPathComponent("transcript.json")
	if process.terminationStatus == 0,
		fileManager.fileExists(atPath: textURL.path),
		fileManager.fileExists(atPath: jsonURL.path)
	{
		return AppBundleTranscribeResult(
			status: 0,
			files: [
				"transcript": textURL.path,
				"transcriptJson": jsonURL.path,
			]
		)
	}
	return AppBundleTranscribeResult(status: process.terminationStatus == 0 ? 1 : process.terminationStatus, files: [:])
}

func transcribeAudioWithBundleBootstrap(inputURL: URL, outDir: URL) async throws -> [String: String] {
	if Bundle.main.bundleURL.pathExtension == "app" {
		return try await transcribeAudio(inputURL: inputURL, outDir: outDir)
	}
	JSONEvent.status("transcribing audio")
	let result = try runTranscribeInAppBundle(TranscribeOptions(input: inputURL, outDir: outDir))
	if result.status != 0 {
		throw HelperError.runtime("Transcription helper exited with status \(result.status)")
	}
	return result.files
}

func runRecord(_ options: RecordOptions) async -> Int32 {
	let session = RecordingSession(options: options)
	var files: [String: String]
	do {
		files = try await session.start()
	} catch {
		JSONEvent.error(code: "start_failed", "\(error)")
		return 1
	}

	while let line = readLine() {
		guard let data = line.data(using: .utf8),
			let command = try? JSONDecoder().decode(StopCommand.self, from: data)
		else {
			continue
		}
		if command.type == "stop" {
			await session.stop()
			if command.action != "discard" {
				do {
					JSONEvent.status("combining audio")
					if let combined = try await exportCombinedAudio(
						files: files,
						outDir: options.outDir
					) {
						files["combined"] = combined
						let transcriptFiles = try await transcribeAudioWithBundleBootstrap(
							inputURL: URL(fileURLWithPath: combined),
							outDir: options.outDir
						)
						files.merge(transcriptFiles) { _, new in new }
					}
				} catch {
					JSONEvent.error(code: "processing_failed", "\(error)")
				}
			}
			JSONEvent.emit([
				"type": "stopped",
				"durationMs": session.durationMs(),
				"files": files,
			])
			return 0
		}
	}

	await session.stop()
	do {
		JSONEvent.status("combining audio")
		if let combined = try await exportCombinedAudio(files: files, outDir: options.outDir) {
			files["combined"] = combined
			let transcriptFiles = try await transcribeAudioWithBundleBootstrap(
				inputURL: URL(fileURLWithPath: combined),
				outDir: options.outDir
			)
			files.merge(transcriptFiles) { _, new in new }
		}
	} catch {
		JSONEvent.error(code: "processing_failed", "\(error)")
	}
	JSONEvent.emit([
		"type": "stopped",
		"durationMs": session.durationMs(),
		"files": files,
	])
	return 0
}

func runTranscribe(_ options: TranscribeOptions, bootstrapAppBundle: Bool = true) async -> Int32 {
	if bootstrapAppBundle && Bundle.main.bundleURL.pathExtension != "app" {
		do {
			let result = try runTranscribeInAppBundle(options)
			if result.status == 0 {
				JSONEvent.emit([
					"type": "transcribed",
					"files": result.files,
				])
			}
			return result.status
		} catch {
			JSONEvent.error(code: "transcribe_failed", "\(error)")
			return 1
		}
	}
	do {
		let files = try await transcribeAudio(inputURL: options.input, outDir: options.outDir)
		JSONEvent.emit([
			"type": "transcribed",
			"files": files,
		])
		return 0
	} catch {
		JSONEvent.error(code: "transcribe_failed", "\(error)")
		return 1
	}
}

func runCombine(_ options: CombineOptions) async -> Int32 {
	do {
		JSONEvent.status("combining audio")
		let files = try await combineAudio(options)
		JSONEvent.emit([
			"type": "combined",
			"files": files,
		])
		return 0
	} catch {
		JSONEvent.error(code: "combine_failed", "\(error)")
		return 1
	}
}

@main
enum TobyAudioHelper {
	static func main() async {
		do {
			let command = try parseCommand(Array(CommandLine.arguments.dropFirst()))
			let code: Int32
			switch command {
			case let .record(options):
				code = await runRecord(options)
			case let .combine(options):
				code = await runCombine(options)
			case let .transcribe(options):
				code = await runTranscribe(options)
			case let .transcribeWorker(options):
				code = await runTranscribe(options, bootstrapAppBundle: false)
			}
			exit(code)
		} catch {
			JSONEvent.error(code: "usage", "\(error)")
			exit(2)
		}
	}
}
