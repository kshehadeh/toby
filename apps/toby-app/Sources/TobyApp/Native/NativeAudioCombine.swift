@preconcurrency import AVFoundation
import Foundation

/// Result of exporting `combined.m4a` from one or more source tracks.
struct NativeAudioCombineResult: Sendable {
	let path: String
	/// Diagnostic fields written into recording metadata under `combine`.
	let details: [String: any Sendable]
}

/// Estimate of system-audio bleed into the microphone track.
struct MicBleedEstimate: Sendable, Equatable {
	/// Samples of delay at `sampleRate` by which system leads the mic copy.
	let lagSamples: Int
	let sampleRate: Double
	/// Peak normalized cross-correlation at that lag (0…1).
	let correlation: Float
	/// Least-squares gain for subtracting delayed system from mic.
	let gain: Float
	var lagMs: Double {
		guard sampleRate > 0 else { return 0 }
		return Double(lagSamples) / sampleRate * 1000
	}
}

enum NativeAudioCombineError: Error, CustomStringConvertible {
	case runtime(String)

	var description: String {
		switch self {
		case .runtime(let message):
			return message
		}
	}
}

// MARK: - Background finalize

/// Validated source tracks plus optional `combined.m4a`, safe to run off the main actor.
struct NativeAudioFinalizeResult: Sendable {
	var files: [String: String]
	var details: [String: any Sendable]
	var errorMessage: String?
}

/// Validate tracks and export `combined.m4a`. Intended for a detached task so
/// long dual-source combines do not freeze SwiftUI.
func finalizeCombinedAudio(files: [String: String], outDir: URL) async -> NativeAudioFinalizeResult {
	let valid = await validatedAudioFiles(files)
	do {
		guard let combined = try await exportCombinedAudio(files: valid, outDir: outDir) else {
			return NativeAudioFinalizeResult(files: valid, details: [:], errorMessage: nil)
		}
		var out = valid
		out["combined"] = combined.path
		return NativeAudioFinalizeResult(
			files: out,
			details: combined.details,
			errorMessage: nil,
		)
	} catch {
		return NativeAudioFinalizeResult(
			files: valid,
			details: [:],
			errorMessage: "\(error)",
		)
	}
}

// MARK: - Public export

/// Combines mic and/or system WAV tracks into `combined.m4a`.
///
/// Dual sources are **not** sample-summed (that reintroduces headphone bleed as
/// an audible echo). Instead they are written as **dual-mono stereo**:
/// left = microphone (your voice), right = system audio (what you heard).
/// Source WAVs stay available for single-track playback and reprocessing.
func exportCombinedAudio(files: [String: String], outDir: URL) async throws -> NativeAudioCombineResult? {
	let micURL = files["mic"].map { URL(fileURLWithPath: $0) }
	let systemURL = files["system"].map { URL(fileURLWithPath: $0) }
	let micExists = micURL.map { FileManager.default.fileExists(atPath: $0.path) } ?? false
	let systemExists = systemURL.map { FileManager.default.fileExists(atPath: $0.path) } ?? false

	if !micExists, !systemExists {
		return nil
	}

	// Single source: re-encode as-is.
	if micExists != systemExists {
		let only = micExists ? micURL! : systemURL!
		let combinedURL = outDir.appendingPathComponent("combined.m4a")
		try await exportURLToM4A(source: only, destination: combinedURL)
		return NativeAudioCombineResult(
			path: combinedURL.path,
			details: [
				"mode": "single",
				"source": micExists ? "mic" : "system",
			],
		)
	}

	// Both sources → dual-mono stereo (L = mic, R = system). Never sum.
	let mic = micURL!
	let system = systemURL!
	let workingRate: Double = 48_000
	let combinedURL = outDir.appendingPathComponent("combined.m4a")
	let stereoURL = outDir.appendingPathComponent(".combined-stereo.\(UUID().uuidString).wav")
	defer {
		if FileManager.default.fileExists(atPath: stereoURL.path) {
			try? FileManager.default.removeItem(at: stereoURL)
		}
	}

	do {
		let sampleCount = try writeDualMonoStereo(
			micURL: mic,
			systemURL: system,
			outputURL: stereoURL,
			sampleRate: workingRate,
		)
		try await exportURLToM4A(source: stereoURL, destination: combinedURL)
		return NativeAudioCombineResult(
			path: combinedURL.path,
			details: [
				"mode": "dual-mono",
				"layout": "L=mic,R=system",
				"sampleRate": workingRate,
				"sampleCount": sampleCount,
			],
		)
	} catch {
		// Avoid the old summed composition (echo). Prefer system-only combined.
		try await exportURLToM4A(source: system, destination: combinedURL)
		return NativeAudioCombineResult(
			path: combinedURL.path,
			details: [
				"mode": "dual-fallback-system",
				"layout": "system-only",
				"fallbackError": "\(error)",
			],
		)
	}
}

// MARK: - Bleed estimation (testable)

/// Cross-correlate mic against system over lags in `[0, maxLagMs]` where
/// positive lag means system leads (system content appears later on the mic).
func estimateMicBleed(
	mic: [Float],
	system: [Float],
	sampleRate: Double,
	maxLagMs: Double = 300,
) -> MicBleedEstimate? {
	let n = min(mic.count, system.count)
	guard n > Int(sampleRate * 0.5), sampleRate > 0 else { return nil }

	let maxLagFull = max(1, Int((maxLagMs / 1000) * sampleRate))
	// Centered analysis window at full rate (no aliasing from decimation).
	let fullWindow = min(n, Int(12 * sampleRate))
	let fullStart = max(0, (n - fullWindow) / 2)
	let fullEnd = min(n, fullStart + fullWindow)
	let micF = Array(mic[fullStart ..< fullEnd])
	let sysF = Array(system[fullStart ..< fullEnd])
	guard micF.count > 1000 else { return nil }

	// Prefer the lag that *removes the most mic energy* when system is
	// subtracted (more robust than raw correlation on tonal content).
	let coarseStep = max(1, Int(sampleRate * 0.0005))
	var bestLag = 0
	var bestReduction: Double = -1
	var bestGain: Float = 0
	var bestCorr: Float = 0
	var lag = 0
	while lag <= maxLagFull {
		let scored = scoreBleedLag(mic: micF, system: sysF, lag: lag)
		if scored.reduction > bestReduction {
			bestReduction = scored.reduction
			bestLag = lag
			bestGain = scored.gain
			bestCorr = scored.correlation
		}
		lag += coarseStep
	}

	let refineLo = max(0, bestLag - coarseStep)
	let refineHi = min(maxLagFull, bestLag + coarseStep)
	for fine in refineLo ... refineHi {
		let scored = scoreBleedLag(mic: micF, system: sysF, lag: fine)
		if scored.reduction > bestReduction {
			bestReduction = scored.reduction
			bestLag = fine
			bestGain = scored.gain
			bestCorr = scored.correlation
		}
	}

	return MicBleedEstimate(
		lagSamples: bestLag,
		sampleRate: sampleRate,
		correlation: bestCorr,
		gain: max(0, min(bestGain, 1.5)),
	)
}

private struct BleedLagScore {
	let reduction: Double
	let gain: Float
	let correlation: Float
}

/// Score a candidate lag by how much LS system subtraction shrinks mic energy.
private func scoreBleedLag(mic: [Float], system: [Float], lag: Int) -> BleedLagScore {
	let corr = normalizedCorrelation(a: mic, b: system, lag: lag)
	let gain = leastSquaresGain(mic: mic, system: system, lag: lag)
	let count = min(mic.count, system.count)
	guard lag >= 0, count > lag + 64, gain > 0 else {
		return BleedLagScore(reduction: 0, gain: 0, correlation: corr)
	}
	var energyBefore: Double = 0
	var energyAfter: Double = 0
	for i in lag ..< count {
		let m = Double(mic[i])
		let s = Double(system[i - lag])
		let residual = m - Double(gain) * s
		energyBefore += m * m
		energyAfter += residual * residual
	}
	let reduction = energyBefore > 1e-12 ? (energyBefore - energyAfter) / energyBefore : 0
	return BleedLagScore(reduction: reduction, gain: gain, correlation: corr)
}

/// Subtract delayed/scaled system from mic: `mic[t] - gain * system[t - lag]`.
func cancelMicBleed(mic: [Float], system: [Float], lag: Int, gain: Float) -> [Float] {
	guard lag >= 0, gain != 0 else { return mic }
	var out = mic
	let n = min(mic.count, system.count)
	if lag >= n { return mic }
	for t in lag ..< n {
		out[t] = mic[t] - gain * system[t - lag]
	}
	return out
}

func normalizedCorrelation(a: [Float], b: [Float], lag: Int) -> Float {
	// corr(a[t], b[t - lag]) for lag >= 0 ⇒ b leads a
	guard lag >= 0 else { return 0 }
	let count = min(a.count, b.count)
	guard count > lag + 64 else { return 0 }
	let len = count - lag
	var sumA: Double = 0
	var sumB: Double = 0
	var sumAA: Double = 0
	var sumBB: Double = 0
	var sumAB: Double = 0
	for i in 0 ..< len {
		let av = Double(a[i + lag])
		let bv = Double(b[i])
		sumA += av
		sumB += bv
		sumAA += av * av
		sumBB += bv * bv
		sumAB += av * bv
	}
	let n = Double(len)
	let meanA = sumA / n
	let meanB = sumB / n
	let num = sumAB - n * meanA * meanB
	let denA = sumAA - n * meanA * meanA
	let denB = sumBB - n * meanB * meanB
	let den = sqrt(max(denA, 0) * max(denB, 0))
	guard den > 1e-12 else { return 0 }
	return Float(num / den)
}

func leastSquaresGain(mic: [Float], system: [Float], lag: Int) -> Float {
	let count = min(mic.count, system.count)
	guard lag >= 0, count > lag + 64 else { return 0 }
	var num: Double = 0
	var den: Double = 0
	// Prefer frames where system energy is present to avoid speech-only bias.
	for i in lag ..< count {
		let s = Double(system[i - lag])
		let m = Double(mic[i])
		let energy = s * s
		if energy < 1e-8 { continue }
		num += m * s
		den += energy
	}
	guard den > 1e-12 else { return 0 }
	return Float(num / den)
}

// MARK: - File I/O + dual-mono

/// Streams mic (L) + system (R) into a stereo WAV. Returns total frame count.
/// Does **not** sum channels — that is what caused meeting “echo.”
private func writeDualMonoStereo(
	micURL: URL,
	systemURL: URL,
	outputURL: URL,
	sampleRate: Double,
) throws -> Int {
	if FileManager.default.fileExists(atPath: outputURL.path) {
		try FileManager.default.removeItem(at: outputURL)
	}
	let settings: [String: Any] = [
		AVFormatIDKey: kAudioFormatLinearPCM,
		AVSampleRateKey: sampleRate,
		AVNumberOfChannelsKey: 2,
		AVLinearPCMBitDepthKey: 16,
		AVLinearPCMIsFloatKey: false,
		AVLinearPCMIsBigEndianKey: false,
		AVLinearPCMIsNonInterleaved: false,
	]
	let writer = try AVAudioFile(forWriting: outputURL, settings: settings)
	// processingFormat is typically Float32 non-interleaved stereo.
	let writeFormat = writer.processingFormat
	guard writeFormat.channelCount >= 2 else {
		throw NativeAudioCombineError.runtime("Expected stereo processing format for dual-mono write.")
	}

	let chunkSeconds = 8.0
	var offset: Double = 0
	var totalFrames = 0

	while true {
		let micChunk = try loadMonoFloatWindow(
			url: micURL,
			targetSampleRate: sampleRate,
			startSeconds: offset,
			durationSeconds: chunkSeconds,
		).samples
		let sysChunk = try loadMonoFloatWindow(
			url: systemURL,
			targetSampleRate: sampleRate,
			startSeconds: offset,
			durationSeconds: chunkSeconds,
		).samples
		if micChunk.isEmpty, sysChunk.isEmpty {
			break
		}
		let count = max(micChunk.count, sysChunk.count)
		if count == 0 { break }

		let frameCount = AVAudioFrameCount(count)
		guard let buffer = AVAudioPCMBuffer(pcmFormat: writeFormat, frameCapacity: frameCount) else {
			throw NativeAudioCombineError.runtime("Could not allocate stereo buffer.")
		}
		buffer.frameLength = frameCount
		guard let ch = buffer.floatChannelData else {
			throw NativeAudioCombineError.runtime("Stereo buffer has no float channel data.")
		}
		// Soft peak limit per channel without summing.
		for i in 0 ..< count {
			var left = i < micChunk.count ? micChunk[i] : 0
			var right = i < sysChunk.count ? sysChunk[i] : 0
			left = max(-0.99, min(0.99, left))
			right = max(-0.99, min(0.99, right))
			ch[0][i] = left
			ch[1][i] = right
		}
		try writer.write(from: buffer)
		totalFrames += count

		offset += chunkSeconds
		let expected = Int(chunkSeconds * sampleRate)
		if micChunk.count < expected, sysChunk.count < expected {
			break
		}
	}

	guard totalFrames > 0 else {
		throw NativeAudioCombineError.runtime("No audio samples to combine.")
	}
	return totalFrames
}

private func loadMonoFloatWindow(
	url: URL,
	targetSampleRate: Double,
	startSeconds: Double,
	durationSeconds: Double?,
) throws -> (samples: [Float], sampleRate: Double) {
	let file = try AVAudioFile(forReading: url)
	let srcFormat = file.processingFormat
	let srcRate = srcFormat.sampleRate
	let totalFrames = file.length
	let startFrame = AVAudioFramePosition(max(0, startSeconds * srcRate))
	guard startFrame < totalFrames else {
		return ([], targetSampleRate)
	}
	let remaining = totalFrames - startFrame
	let framesToRead: AVAudioFrameCount
	if let durationSeconds {
		framesToRead = AVAudioFrameCount(min(AVAudioFramePosition(durationSeconds * srcRate), remaining))
	} else {
		framesToRead = AVAudioFrameCount(remaining)
	}
	guard framesToRead > 0 else {
		return ([], targetSampleRate)
	}

	file.framePosition = startFrame
	guard let srcBuffer = AVAudioPCMBuffer(pcmFormat: srcFormat, frameCapacity: framesToRead) else {
		throw NativeAudioCombineError.runtime("Could not allocate audio buffer.")
	}
	try file.read(into: srcBuffer, frameCount: framesToRead)

	let monoSrc = monoFloat(from: srcBuffer)

	if abs(srcRate - targetSampleRate) < 0.5 {
		return (monoSrc, targetSampleRate)
	}

	guard let monoFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: srcRate, channels: 1, interleaved: false),
		let dstFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: targetSampleRate, channels: 1, interleaved: false)
	else {
		throw NativeAudioCombineError.runtime("Could not create audio formats for resampling.")
	}

	// Rebuild a mono buffer at source rate for conversion.
	guard let monoBuffer = AVAudioPCMBuffer(pcmFormat: monoFormat, frameCapacity: AVAudioFrameCount(monoSrc.count)) else {
		throw NativeAudioCombineError.runtime("Could not allocate mono buffer.")
	}
	monoBuffer.frameLength = AVAudioFrameCount(monoSrc.count)
	if let ch = monoBuffer.floatChannelData {
		for i in 0 ..< monoSrc.count {
			ch[0][i] = monoSrc[i]
		}
	}

	guard let converter = AVAudioConverter(from: monoFormat, to: dstFormat) else {
		throw NativeAudioCombineError.runtime("Could not create audio converter.")
	}
	let ratio = targetSampleRate / srcRate
	let dstCapacity = AVAudioFrameCount(Double(monoSrc.count) * ratio) + 32
	guard let dstBuffer = AVAudioPCMBuffer(pcmFormat: dstFormat, frameCapacity: dstCapacity) else {
		throw NativeAudioCombineError.runtime("Could not allocate resample buffer.")
	}

	final class InputFlag: @unchecked Sendable {
		var supplied = false
	}
	let flag = InputFlag()
	let inputBlock: AVAudioConverterInputBlock = { _, outStatus in
		if flag.supplied {
			outStatus.pointee = .noDataNow
			return nil
		}
		flag.supplied = true
		outStatus.pointee = .haveData
		return monoBuffer
	}
	var error: NSError?
	converter.convert(to: dstBuffer, error: &error, withInputFrom: inputBlock)
	if let error {
		throw NativeAudioCombineError.runtime("Resample failed: \(error.localizedDescription)")
	}
	return (monoFloat(from: dstBuffer), targetSampleRate)
}

private func monoFloat(from buffer: AVAudioPCMBuffer) -> [Float] {
	let frames = Int(buffer.frameLength)
	guard frames > 0 else { return [] }
	if buffer.format.commonFormat == .pcmFormatFloat32, let ch = buffer.floatChannelData {
		let channels = Int(buffer.format.channelCount)
		if channels == 1 {
			return Array(UnsafeBufferPointer(start: ch[0], count: frames))
		}
		var out = [Float](repeating: 0, count: frames)
		let scale = 1 / Float(channels)
		for c in 0 ..< channels {
			let ptr = ch[c]
			for i in 0 ..< frames {
				out[i] += ptr[i] * scale
			}
		}
		return out
	}
	if buffer.format.commonFormat == .pcmFormatInt16, let ch = buffer.int16ChannelData {
		let channels = Int(buffer.format.channelCount)
		var out = [Float](repeating: 0, count: frames)
		let scale = 1 / Float(channels) / 32768
		for c in 0 ..< channels {
			let ptr = ch[c]
			for i in 0 ..< frames {
				out[i] += Float(ptr[i]) * scale
			}
		}
		return out
	}
	// Fallback: try float after conversion not available — empty.
	return []
}

private func exportURLToM4A(source: URL, destination: URL) async throws {
	if FileManager.default.fileExists(atPath: destination.path) {
		try FileManager.default.removeItem(at: destination)
	}
	let partialURL = destination
		.deletingLastPathComponent()
		.appendingPathComponent(".combined.\(UUID().uuidString).partial.m4a")
	defer {
		if FileManager.default.fileExists(atPath: partialURL.path) {
			try? FileManager.default.removeItem(at: partialURL)
		}
	}

	let asset = AVURLAsset(url: source)
	guard let exportSession = AVAssetExportSession(
		asset: asset,
		presetName: AVAssetExportPresetAppleM4A,
	) else {
		throw NativeAudioCombineError.runtime("Could not create combined audio export session.")
	}
	do {
		try await exportSession.export(to: partialURL, as: .m4a)
	} catch {
		throw NativeAudioCombineError.runtime(error.localizedDescription)
	}
	try FileManager.default.moveItem(at: partialURL, to: destination)
}


