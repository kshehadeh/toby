import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

let helperVersion = "0.2.0"

struct RecordOptions {
	let outDir: URL
	let format: String
	let mic: Bool
	let system: Bool
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

func parseOptions(_ args: [String]) throws -> RecordOptions {
	if args == ["--version"] || args == ["version"] {
		print(helperVersion)
		exit(0)
	}
	guard args.first == "record" else {
		throw HelperError.usage(
			"Usage: toby-audio-helper record --out-dir <dir> --format wav [--mic] [--system]"
		)
	}
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
	if FileManager.default.fileExists(atPath: combinedURL.path) {
		try FileManager.default.removeItem(at: combinedURL)
	}
	guard let exportSession = AVAssetExportSession(
		asset: composition,
		presetName: AVAssetExportPresetAppleM4A
	) else {
		throw HelperError.runtime("Could not create combined audio export session")
	}
	exportSession.outputURL = combinedURL
	exportSession.outputFileType = .m4a
	await withCheckedContinuation { continuation in
		exportSession.exportAsynchronously {
			continuation.resume()
		}
	}
	if exportSession.status == .completed {
		return combinedURL.path
	}
	let message = exportSession.error?.localizedDescription ?? "Unknown export failure"
	throw HelperError.runtime("Could not export combined audio: \(message)")
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
			do {
				JSONEvent.status("combining audio")
				if let combined = try await exportCombinedAudio(
					files: files,
					outDir: options.outDir
				) {
					files["combined"] = combined
				}
			} catch {
				JSONEvent.error(code: "combine_failed", "\(error)")
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
		}
	} catch {
		JSONEvent.error(code: "combine_failed", "\(error)")
	}
	JSONEvent.emit([
		"type": "stopped",
		"durationMs": session.durationMs(),
		"files": files,
	])
	return 0
}

@main
enum TobyAudioHelper {
	static func main() async {
		do {
			let options = try parseOptions(Array(CommandLine.arguments.dropFirst()))
			let code = await runRecord(options)
			exit(code)
		} catch {
			JSONEvent.error(code: "usage", "\(error)")
			exit(2)
		}
	}
}
