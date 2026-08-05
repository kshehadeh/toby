import AVFoundation
import CoreMedia
import Foundation
import Testing
@testable import TobyApp

@Suite("Native audio combine / bleed cancel")
struct NativeAudioCombineTests {
	@Test("estimates lag when mic contains delayed system bleed")
	func estimatesLagAndGain() {
		let sampleRate = 16_000.0
		let duration = 4.0
		let n = Int(sampleRate * duration)
		let lagSamples = Int(0.167 * sampleRate) // ~167 ms, matching real meeting
		let bleedGain: Float = 0.35

		// Broadband noise (not pure tones) so lag is unambiguous.
		var system = [Float](repeating: 0, count: n)
		var rng: UInt64 = 0xC0FFEE
		for i in 0 ..< n {
			rng = rng &* 6_364_136_223_846_793_005 &+ 1
			let unit = Float(Int64(bitPattern: rng) % 10_000) / 10_000 - 0.5
			system[i] = unit
		}
		// Light low-pass for slightly more speech-like spectrum.
		for i in 1 ..< n {
			system[i] = 0.7 * system[i] + 0.3 * system[i - 1]
		}

		var mic = [Float](repeating: 0, count: n)
		for i in 0 ..< n {
			rng = rng &* 6_364_136_223_846_793_005 &+ 1
			let local = Float(Int64(bitPattern: rng) % 10_000) / 20_000 - 0.25
			let delayed = i >= lagSamples ? system[i - lagSamples] : 0
			mic[i] = local * 0.4 + bleedGain * delayed
		}

		let estimate = estimateMicBleed(
			mic: mic,
			system: system,
			sampleRate: sampleRate,
			maxLagMs: 300,
		)

		#expect(estimate != nil)
		guard let estimate else { return }
		#expect(abs(estimate.lagSamples - lagSamples) <= 4)
		#expect(estimate.correlation > 0.4)
		// LS gain is approximate when local noise is mixed into the mic.
		#expect(abs(estimate.gain - bleedGain) < 0.15)
		#expect(estimate.gain > 0.15)
	}

	@Test("cancelMicBleed reduces delayed system correlation")
	func cancelReducesBleed() {
		let sampleRate = 16_000.0
		let n = Int(sampleRate * 3)
		let lag = Int(0.12 * sampleRate)
		let gain: Float = 0.4

		var system = [Float](repeating: 0, count: n)
		for i in 0 ..< n {
			let t = Double(i) / sampleRate
			system[i] = Float(sin(2 * .pi * 500 * t))
		}
		var mic = [Float](repeating: 0, count: n)
		for i in 0 ..< n {
			let delayed = i >= lag ? system[i - lag] : 0
			mic[i] = 0.2 + gain * delayed
		}

		let before = normalizedCorrelation(a: mic, b: system, lag: lag)
		let cleaned = cancelMicBleed(mic: mic, system: system, lag: lag, gain: gain)
		let after = normalizedCorrelation(a: cleaned, b: system, lag: lag)

		#expect(before > 0.5)
		#expect(after < before * 0.25)
	}

	@Test("skips cancel when tracks are uncorrelated")
	func uncorrelatedTracksLowCorrelation() {
		let sampleRate = 16_000.0
		let n = Int(sampleRate * 2)
		var mic = [Float](repeating: 0, count: n)
		var system = [Float](repeating: 0, count: n)
		for i in 0 ..< n {
			let t = Double(i) / sampleRate
			mic[i] = Float(sin(2 * .pi * 180 * t))
			system[i] = Float(sin(2 * .pi * 910 * t + 1.2))
		}
		let estimate = estimateMicBleed(
			mic: mic,
			system: system,
			sampleRate: sampleRate,
			maxLagMs: 300,
		)
		#expect(estimate != nil)
		if let estimate {
			#expect(estimate.correlation < 0.25)
		}
	}

	@Test("exportCombinedAudio dual-source writes dual-mono stereo without crash")
	func dualSourceExportIsDualMonoStereo() async throws {
		let dir = FileManager.default.temporaryDirectory
			.appendingPathComponent("toby-combine-\(UUID().uuidString)", isDirectory: true)
		try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
		defer { try? FileManager.default.removeItem(at: dir) }

		let sampleRate = 48_000.0
		let seconds = 1.0
		let n = Int(sampleRate * seconds)
		var mic = [Float](repeating: 0, count: n)
		var system = [Float](repeating: 0, count: n)
		let lag = Int(0.05 * sampleRate)
		for i in 0 ..< n {
			let t = Double(i) / sampleRate
			system[i] = Float(0.3 * sin(2 * .pi * 440 * t))
			let delayed = i >= lag ? system[i - lag] : 0
			mic[i] = Float(0.2 * sin(2 * .pi * 220 * t)) + 0.2 * delayed
		}
		let micURL = dir.appendingPathComponent("mic.wav")
		let systemURL = dir.appendingPathComponent("system.wav")
		try writeTestMonoWav(samples: mic, sampleRate: sampleRate, url: micURL)
		try writeTestMonoWav(samples: system, sampleRate: sampleRate, url: systemURL)

		let result = try await exportCombinedAudio(
			files: ["mic": micURL.path, "system": systemURL.path],
			outDir: dir,
		)
		#expect(result != nil)
		guard let result else { return }
		#expect(FileManager.default.fileExists(atPath: result.path))
		let size = try FileManager.default.attributesOfItem(atPath: result.path)[.size] as? NSNumber
		#expect((size?.intValue ?? 0) > 1000)
		if let mode = result.details["mode"] as? String {
			#expect(mode == "dual-mono" || mode == "dual-fallback-system")
		}
		// Dual-mono path should leave a playable stereo (or mono fallback) file.
		let asset = AVURLAsset(url: URL(fileURLWithPath: result.path))
		let tracks = try await asset.loadTracks(withMediaType: .audio)
		#expect(!tracks.isEmpty)
		let duration = try await asset.load(.duration)
		#expect(CMTimeGetSeconds(duration) > 0.5)
	}
}

/// Writes mono float samples via AVAudioFile processingFormat (Float32).
private func writeTestMonoWav(samples: [Float], sampleRate: Double, url: URL) throws {
	let settings: [String: Any] = [
		AVFormatIDKey: kAudioFormatLinearPCM,
		AVSampleRateKey: sampleRate,
		AVNumberOfChannelsKey: 1,
		AVLinearPCMBitDepthKey: 16,
		AVLinearPCMIsFloatKey: false,
		AVLinearPCMIsBigEndianKey: false,
		AVLinearPCMIsNonInterleaved: false,
	]
	let file = try AVAudioFile(forWriting: url, settings: settings)
	let format = file.processingFormat
	let frameCount = AVAudioFrameCount(samples.count)
	guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else {
		throw NSError(domain: "test", code: 1)
	}
	buffer.frameLength = frameCount
	if let ch = buffer.floatChannelData {
		for i in 0 ..< samples.count {
			ch[0][i] = samples[i]
		}
	}
	try file.write(from: buffer)
}
