import AVFoundation
import CoreMedia
import SwiftUI

struct RecordingAudioPlayerView: View {
	let detail: ListenRecordingDetail
	@State private var audioPlayer = RecordingAudioPlayer()
	@State private var selectedSourceId: String = ""
	private let timer = Timer.publish(every: 0.25, on: .main, in: .common).autoconnect()

	private var sources: [(id: String, label: String, path: String)] {
		detail.playableAudioSources
	}

	private var selectedPath: String? {
		if let match = sources.first(where: { $0.id == selectedSourceId }) {
			return match.path
		}
		return sources.first?.path
	}

	private func defaultSourceId() -> String {
		// Prefer System for dual recordings (clean meeting audio), else first available.
		if sources.contains(where: { $0.id == "system" }) { return "system" }
		return sources.first?.id ?? ""
	}

	var body: some View {
		SettingsCard {
			VStack(alignment: .leading, spacing: 12) {
				if detail.hasAudio, selectedPath != nil {
					if sources.count > 1 {
						Picker("Source", selection: $selectedSourceId) {
							ForEach(sources, id: \.id) { source in
								Text(source.label).tag(source.id)
							}
						}
						.labelsHidden()
						.pickerStyle(.segmented)
						.accessibilityIdentifier("recording-audio-source-picker")
					}

					HStack(spacing: 12) {
						Button {
							audioPlayer.togglePlayback()
						} label: {
							Image(systemName: audioPlayer.isPlaying ? "pause.fill" : "play.fill")
								.frame(width: 14, height: 14)
								.foregroundStyle(SettingsDesign.rowTitle)
								.padding(9)
								.background(
									Circle()
										.fill(AppTheme.accent.opacity(0.28))
								)
						}
						.buttonStyle(.plain)
						.disabled(!audioPlayer.isReady)

						VStack(alignment: .leading, spacing: 6) {
							Slider(
								value: Binding(
									get: { audioPlayer.currentTime },
									set: { audioPlayer.seek(to: $0) },
								),
								in: 0 ... max(audioPlayer.duration, 1),
							)
							HStack {
								Text(playbackTimeText(audioPlayer.currentTime))
								Spacer()
								Text(playbackTimeText(audioPlayer.duration))
							}
							.font(.caption.monospacedDigit())
							.foregroundStyle(SettingsDesign.rowDescription)
						}
					}
				} else {
					Text("No audio file is available for this recording.")
						.font(.subheadline)
						.foregroundStyle(SettingsDesign.rowDescription)
				}

				if let errorMessage = audioPlayer.errorMessage {
					InlineStatusMessage(message: errorMessage, tone: .error, font: .caption)
				}
			}
			.padding(.horizontal, SettingsDesign.rowHorizontalPadding)
			.padding(.vertical, SettingsDesign.rowVerticalPadding)
		}
		.onAppear {
			if selectedSourceId.isEmpty || !sources.contains(where: { $0.id == selectedSourceId }) {
				selectedSourceId = defaultSourceId()
			}
		}
		.onChange(of: detail.id) { _, _ in
			selectedSourceId = defaultSourceId()
		}
		.task(id: "\(detail.id)-\(selectedPath ?? "")") {
			await audioPlayer.load(audioPath: selectedPath, fallbackDurationMs: detail.metadata.durationMs)
		}
		.onReceive(timer) { _ in
			audioPlayer.refresh()
		}
		.onDisappear {
			audioPlayer.stop()
		}
	}
}

@Observable
@MainActor
final class RecordingAudioPlayer {
	private var player: AVAudioPlayer?
	private var loadedAudioPath: String?
	var isPlaying = false
	var currentTime: TimeInterval = 0
	var duration: TimeInterval = 0
	var errorMessage: String?

	var isReady: Bool {
		loadedAudioPath != nil && errorMessage == nil
	}

	func load(audioPath: String?, fallbackDurationMs: Int? = nil) async {
		guard loadedAudioPath != audioPath else { return }
		stop()
		loadedAudioPath = audioPath
		errorMessage = nil
		currentTime = 0
		duration = TimeInterval(max(0, fallbackDurationMs ?? 0)) / 1000
		guard let audioPath else {
			player = nil
			return
		}
		let url = URL(fileURLWithPath: audioPath)
		do {
			let loadedDuration = try await Task.detached(priority: .userInitiated) {
				let asset = AVURLAsset(url: url)
				let time = try await asset.load(.duration)
				return CMTimeGetSeconds(time)
			}.value
			guard loadedAudioPath == audioPath else { return }
			if loadedDuration.isFinite, loadedDuration > 0 {
				duration = loadedDuration
			}
			// Open the player on first play so selecting a long recording does
			// not decode the whole file on the main actor.
		} catch {
			guard loadedAudioPath == audioPath else { return }
			errorMessage = "Could not load audio: \(error.localizedDescription)"
		}
	}

	func togglePlayback() {
		if player == nil {
			preparePlayerIfNeeded()
		}
		guard let player else { return }
		if player.isPlaying {
			player.pause()
			isPlaying = false
			refresh()
			return
		}
		if duration > 0, player.currentTime >= duration {
			player.currentTime = 0
		}
		player.play()
		isPlaying = true
		refresh()
	}

	func seek(to time: TimeInterval) {
		guard let player else { return }
		player.currentTime = min(max(time, 0), duration)
		refresh()
	}

	func refresh() {
		guard let player else {
			isPlaying = false
			currentTime = 0
			return
		}
		currentTime = player.currentTime
		duration = player.duration
		isPlaying = player.isPlaying
	}

	func stop() {
		player?.stop()
		player = nil
		isPlaying = false
		currentTime = 0
		duration = 0
	}

	private func preparePlayerIfNeeded() {
		guard player == nil, let loadedAudioPath else { return }
		do {
			let nextPlayer = try AVAudioPlayer(contentsOf: URL(fileURLWithPath: loadedAudioPath))
			nextPlayer.prepareToPlay()
			player = nextPlayer
			if nextPlayer.duration > 0 {
				duration = nextPlayer.duration
			}
			errorMessage = nil
		} catch {
			player = nil
			errorMessage = "Could not load audio: \(error.localizedDescription)"
		}
	}
}
